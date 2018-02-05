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
                t.integer('team1').unsigned().references('id').inTable('teams');
                t.integer('team2').unsigned().references('id').inTable('teams');
                t.string('scores');
                t.timestamp('date');
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
            let insertToPromise = (obj, table) => {
                let promise = obj ? knex(table).insert(obj) : Promise.resolve();
                promise = promise.catch(err => {
                    if (err.message.indexOf("duplicate key value violates unique constraint") !== -1) {
                        return Promise.resolve();
                    } else {
                        throw err;
                    }
                })
                return promise;
            }

            for (let i = 1; i < 11; i++) {
                chain = chain.then(obj => decompressor.parseEvent().then(obj => {
                    let objects = decompressor.validate(obj);
                    chainDb = chainDb.then(() => {
                        //save in Db
                        return Promise.all([
                            insertToPromise(objects.team1, "teams"),
                            insertToPromise(objects.team2, "teams")
                        ])
                        .then(res => insertToPromise(objects.event, "events"))
                        .catch(err => {
                            console.error("Error in chainDb: " + err.message);
                            return Promise.resolve();
                        })
                    });
                    socket.emit('eventsLoaded', { number: i });
                }))
                .catch(err => {
                    console.error("Error in chain: " + err);
                    return Promise.resolve();
                })
            }
            chain = chain.then(() => {
                chainDb = chainDb.then(() => {
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
                (select t.name from teams t where t.id = e.team1) as team1,
                (select t.name from teams t where t.id = e.team2) as team2,
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
            res.status(200).send({
                numberEvents: numberEvents,
                events: arr.rows
            })
        })
        .catch(err => {
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
                    select id from events order by ` + rand + ' limit '+ numberEvents +' )'
                return knex.raw(sqlString)
            })
            .then(() => res.status(200).send({
                deleted: numberEvents
            }))
            .catch(err => res.status(500).send({
                error: err.message
            }))
        } else {
            res.status(500).send({
                error: "wrong body parametr"
            })
        }
    });
})
