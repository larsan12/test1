const zlib = require("zlib");
const fs = require('fs');

class Decopressor {

    constructor(path) {
        this.lenghtReading = 100;
        this.readBytes = 0;
        this.stringUnparsed = "";

        this.file = fs.openSync("./data/events.json.gz", 'r');
        this.decompressStream = zlib.createGunzip();
        this.promises = {
            resolve: () => {},
            reject: () => {}
        };
        this.decompressStream
            .on('data', chunk => {
                this.promises.resolve(chunk.toString())
            })
            .on('error', err => this.promises.reject(err));
    }

    streamToPromise() {
        return new Promise((resolve, reject) => {
            this.promises = {
                resolve: resolve,
                reject: reject
            }
        });
    }

    partialDecompress(start, end) {

        if (start < 0 || end < 0 || end < start || end - start > 0x3fffffff) {
            return Promise.reject(new Error('bad start, end'));
        }
        if (end - start === 0) {
            return Promise.resolve(new Buffer(0));
        }

        return new Promise((resolve, reject) =>
            fs.read(this.file, new Buffer(end - start), 0, end - start, start, (errRead, bytesReaded, buffer) => {
                if (bytesReaded === 0) {
                    return reject("finish reading");
                };
                if (errRead) {
                    reject(errRead);
                } else {
                    let promise = this.streamToPromise();
                    this.decompressStream.write(buffer);
                    resolve(promise);
                }
            })
        )
    };

    parseEvent() {

        let saveParsed = (parsed) => {
            let index = this.stringUnparsed.indexOf(parsed);
            if (index === -1) {
                throw new Error("ERROR3: \n" + this.stringUnparsed + "\n parsed: \n" + parsed)
            }
            this.stringUnparsed = this.stringUnparsed.substring(parsed.length + index);
            return Promise.resolve(JSON.parse(parsed));
        }

        if (this.stringUnparsed.length > 0) {
            let parsed;
            try {
                parsed = this.findObjects(this.stringUnparsed);
            } catch (e) {
                return this.parseEvent();
            };

            if (parsed) {
                return saveParsed(parsed);
            }
        }

        return this.partialDecompress(this.readBytes, this.lenghtReading + this.readBytes)
            .then(str => {
                this.stringUnparsed +=str;
                this.readBytes +=this.lenghtReading;
                let parsed;
                try {
                    parsed = this.findObjects(this.stringUnparsed);
                } catch (e) {
                    return this.parseEvent();
                }
                if (parsed) {
                    return saveParsed(parsed);
                } else {
                    return this.parseEvent();
                }
            })
    }

    findObjects(str) {
        let reg = /\{[^\[\]\}\{]*\[{[^\[\]\}\{]*\}\,\{[^\[\]\}\{]*\}][^\[\]\}\{]*\}/m;
        let result = reg.exec(str);

        if (!result/* || result.index !== 1*/) {
            if (result && result.index !== 1) {
                //throw new Error("ERROR1: \n" + str + "\n result[0]: \n" + result[0])
            }
            return false
        }

        try {
            JSON.parse(result[0]);
        } catch (err) {
            this.stringUnparsed = this.stringUnparsed.substring(result[0].length + this.stringUnparsed.indexOf(result[0]))
            throw new Error("ERROR2: \n" + str + "\n result[0]: \n" + result[0])
        }

        return result[0];
    }

    validate(obj) {
        let result = {
            "event": "",
            "team1": "",
            "team2": ""
        };

        result.event = {
            id: obj.id,
            date: obj.date,
            team1_id: obj.teams && obj.teams.length && obj.teams[0].id,
            team2_id: obj.teams && obj.teams.length > 1 && obj.teams[1].id,
            team1_name: obj.teams && obj.teams.length && obj.teams[0].name,
            team2_name: obj.teams && obj.teams.length > 1 && obj.teams[1].name,
            scores: obj.scores
        };

        if (!result.event.id || !result.event.team1_id || !result.event.team2_id) {
            result.event = null;
        }

        if (obj.teams && obj.teams.length && obj.teams[0].id) {
            result.team1 = {
                id: obj.teams[0].id,
                location: obj.teams[0].location,
                name: obj.teams[0].location,
            }
        }

        if (obj.teams && obj.teams.length > 1 && obj.teams[1].id) {
            result.team2 = {
                id: obj.teams[1].id,
                location: obj.teams[1].location,
                name: obj.teams[1].location,
            }
        }

        return result;

    }

}


var decompressor = new Decopressor();
var getTenEvents = () => {
    let chain = Promise.resolve();
    let events = [];

    for (let i = 0; i < 10; i++) {
        chain = chain.then(obj => decompressor.parseEvent().then(obj => {
            events.push(obj);
        }))
    }

    chain = chain
    .then(() => events)
    .catch(err => {
        console.log(err);
        return Promise.resolve();
    });

    return chain;
}

module.exports.decompressor = decompressor;
module.exports.getTenEvents = getTenEvents;
