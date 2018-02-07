const express = require('express');
const app = express();
const sio = require('socket.io');
const path = require('path');
const decompressor = require('./Decompressor').decompressor;
const getTenEvents = require('./Decompressor').getTenEvents;
const config = require("./config.json");
const bodyParser = require('body-parser')
const knex = require('knex')({
    client: config.client,
    connection: {
        host : config.host,
        user : config.user,
        password : config.password,
        database : config.database
    }
});

initializeDb = () => {
    return knex.schema.hasTable('teams').then(exists => {
        if (!exists) {
            return knex.schema.createTable('teams', t => {
                t.integer('id').notNullable().primary();
                t.string('name');
                t.string('location');
            });
        }
    }).then(() => knex.schema.hasTable('events').then(exists => {
        if (!exists) {
            return knex.schema.createTable('events', t => {
                t.integer('id').notNullable().primary();
                t.string('scores');
                t.timestamp('date');
            });
        }
    }))
    .then(() => knex.schema.hasTable('teamsInEvent').then(exists => {
        if (!exists) {
            return knex.schema.createTable('teamsInEvent', t => {
                t.integer('event_id').unsigned().references('id').inTable('events').onDelete('CASCADE');
                t.integer('team_id').unsigned().references('id').inTable('teams').onDelete('CASCADE');
                t.unique(['event_id', 'team_id']);
                t.string('team_name');
            });
        }
    }))
}


app.use(bodyParser.json());
app.use('/static', express.static(path.resolve(__dirname + '/../client')));
app.get('/', function (req, res) {
    res.sendFile(path.resolve(__dirname + '/../client/index.html'));
});

const server = app.listen(config.port);
console.log("Server run at " + config.port + " port");
const io = sio.listen(server);


initializeDb().then(() => {
    // chain - для декомпрессора
    // сhainDb - для knex

    let chain = Promise.resolve();
    let chainDb = Promise.resolve();

    io.on('connection', socket => {

        /*
            getTenEvents: загрузить 10 эвентов
            оповещение через сокет
        */

        socket.on('getTenEvents', () => {
            // function to ignore dublicate key error
            let ignoreDublicateError = (data, table) => {
                let onConflict = " \n ON CONFLICT (id) DO NOTHING";
                if (table === "teamsInEvent" ) {
                    onConflict = " \n ON CONFLICT (event_id, team_id) DO NOTHING"
                }
                let sqlString = knex.insert(data).into(table).toString() + onConflict;
                return knex.raw(sqlString);
            };

            let events = {
                teams: [],
                events: [],
                teamsInEvent: []
            };

            for (let i = 1; i < 11; i++) {
                chain = chain.then(obj => decompressor.parseEvent().then(obj => {
                    let objects = decompressor.validate(obj);
                    events = {
                        teams: events.teams.concat(objects.teams),
                        events: events.events.concat(objects.events),
                        teamsInEvent: events.teamsInEvent.concat(objects.teamsInEvent),
                    }
                    socket.emit('eventsLoaded', { number: i });
                }))
                .catch(err => {
                    console.error(err);
                    return Promise.resolve();
                })
            };

            chain = chain.then(() => {
                chainDb = chainDb.then(() => {
                    //save in Db
                    return ignoreDublicateError(events.teams.filter(t => t), "teams")
                        .then(res => ignoreDublicateError(events.events.filter(t => t), "events"))
                        .then(res => ignoreDublicateError(events.teamsInEvent.filter(t => t), "teamsInEvent"))
                        .catch(err => {
                            console.error("Error in chainDb: " + err.message);
                            return Promise.resolve();
                        })
                }).then(() => {
                    io.emit("dbUpdated")
                });
                return Promise.resolve();
            });
        });
    });

    /*
        /refresh_data : обновить информацию о данных - колличество выгруженных эвентов и первые 10 элементов (1-я страница),
        либо 10 элементов, начиная с req.offset
    */


    app.get('/refresh_data', function (req, res) {
        let numberEvents;

        knex('events').count('*').then(r => {
            numberEvents = r[0].count;
            let sqlString = `SELECT e.id,
                (select array(SELECT team_name FROM "teamsInEvent" t WHERE t.event_id=e.id)) as teams,
                e.scores,
                e.date
                FROM events e
                LIMIT 10`;
            if (req.query.page && req.query.page > 0) {
                if (req.query.page * 10 < numberEvents) {
                    sqlString = sqlString + "\n OFFSET " + req.query.page * 10 + ";";
                }
            }
            return knex.raw(sqlString)
        })
        .then(arr => {
            let events = arr.rows ? arr.rows.map(e => {
                if (e.teams.length >1) {
                    e.team1 = e.teams[0];
                    e.team2 = e.teams[1];
                }

                delete e.teams;
                return e
            }) : [];
            res.status(200).send({
                numberEvents: numberEvents,
                events: events
            })
        })
        .catch(err => {
            console.log(err)
            res.status(500).send({
                error: err.message
            })
        })
    });

    /*
        /remove_data - удалить body.percentage - % случайных эвентов
    */

    app.post('/remove_data', function (req, res) {
        let p = req.body ? req.body.percentage/100 : NaN;

        if (p && p > 0 && p <= 1) {
            let numberEvents = 0;
            knex('events').count('*').then(r => {
                numberEvents = Math.round(r[0].count*p);
                let rand = config.client === "pg" ? "RANDOM()" : "RAND()";
                let sqlString = `
                DELETE FROM events
                WHERE id in (
                    select id from events order by ? limit ? )`;
                return knex.raw(sqlString, [rand, numberEvents])
            })
            .then(() => res.status(200).send({
                deleted: numberEvents
            }))
            .catch(err => {
                console.log(err);
                res.status(500).send({
                    error: err.message
                })
            })
        } else {
            res.status(500).send({
                error: "wrong body parametr"
            })
        }
    });
})
