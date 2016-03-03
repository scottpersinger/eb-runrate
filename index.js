#!/usr/bin/env node
var WebSocket = require('faye-websocket'),
    fs = require('fs'),
    redisMod = require("redis"),
    redis = redisMod.createClient(process.env['REDIS_URL']),
    express = require('express'),
    app = express(),
    http = require('http'),
    server = http.createServer(app);

app.use(express.static('static'));

redis.on("error", function (err) {
    console.log("Redis error " + err);
});

DEFAULT_SOCKET_URL = "wss://eventbus-sub.api.herokai.com"
LEADERBOARD_LIMIT = 30

function connect_eventbus(initial_offsets) {
    client = new WebSocket.Client(DEFAULT_SOCKET_URL);

    var stream = 'api-events';
    var authentication = process.env['EB_AUTH']; 
    var state = 'pending';
    var connection_id = null;

    client.on('error', function(error) {
        console.log('Connection Error: ', error);
    });
     
    client.on('open', function(event) {
        state = 'connected';

        console.log('WebSocket Client Connected');
        client.on('close', function() {
            console.log('echo-protocol Connection Closed');
        });

        // utils
        function announce(data) {
            data['id'] = connection_id;
            console.log("Sending ", data);
            client.send(JSON.stringify(data));
        }

        function expect_message(expected_status, callback) {
            client.on('message', function(event) {
                var payload = JSON.parse(event.data);
                if (payload['status'] == expected_status) {
                    console.log("Received payload: ", payload);
                    callback(payload);
                } //else {
                  //  console.log("Unexpected payload ", payload);
                //}
            });
        }

        function save_offsets(offsets) {
            redis.set("__partition_offsets", JSON.stringify(offsets));
        }

        function calc_delta(dateStr) {
            var d = new Date(Date.parse(dateStr));
            return Math.abs(new Date() - d) / 1000.0;
        }

        function is_formation(message) {
            return (message.action && message.action == 'update' &&
                message.resource && message.resource == 'formation');
        }

        function process_formation(message) {
            var app = message.data.app.name;
            //console.log(app + " lag is " + (calc_delta(message.published_at)/1000) + " seconds ");
            var old_form = {};
            redis.get(app + "/formation", function(err, payload) {
                if (!err && payload) {
                    old_form = JSON.parse(payload);
                }
                old_form.timestamp = message.updated_at;
                if (old_form.dynos == undefined) {
                    old_form.dynos = {}
                }
                old_form.dynos[message.data.size] = message.data.quantity;
                var total = 0;
                for (var k in old_form.dynos) {
                    total += old_form.dynos[k];
                    redis.zadd(['topapps',-total,app])
                    redis.zremrangebyrank(['topapps', LEADERBOARD_LIMIT, -1])
                }
                //console.log(old_form);
                redis.set(app + "/formation", JSON.stringify(old_form));
            });
        }

        function print_leaderboard() {
            redis.zrange(['topapps', 0, -1, "WITHSCORES"], function(err, data) {
                console.log("Leaders: ", data);
            });
        }
        setInterval(function() {console.log("heatbeat..")}, 5000);

        var filter_app = 'ql-test'; //'quizlive-react';

        var partition_offsets = {};


        // Protocol
        expect_message('ready', function(payload) {
            connection_id = payload["id"];
            state = 'ready';

            announce({client:'Node sample', version:'0.1', 
                      stream:stream, 
                      authentication:authentication, 
                      state:initial_offsets ? new Buffer(initial_offsets).toString("base64") : null});

            expect_message('streaming', function(payload) {
                state = 'streaming';

                console.log("STARTING STREAM LISTENER...");
                client.on('message', function(event) {
                    var payload = JSON.parse(event.data);
                    partition_offsets[payload.partition] = payload.offset;
                    save_offsets(partition_offsets);

                    var message = payload.body;
                    if (is_formation(message)) {
                        //console.log(message);
                        process_formation(message);
                    }

                    /*
                    if (payload.body.data && payload.body.data.app && payload.body.data.app.name) {
                        if (!filter_app || filter_app == payload.body.data.app.name) {
                            console.log(payload);
                            var delta = calc_delta(payload.body.published_at);
                            console.log("[" + delta + " secs ago] - ", payload.body.data.app.name + " - " + 
                                payload.body.action + ":" + payload.body.resource);
                        }
                    }*/

                });

            });
        });

    });

}

redis.get("__partition_offsets", function(err, initial_offsets) {
    connect_eventbus(initial_offsets);
});

app.get('/topapps', function(request, response) {
    redis.zrange(['topapps', 0, -1, "WITHSCORES"], function(err, data) {
        var results = [];
        for (var i = 0; i < data.length; i+=2) {
            results.push({app: data[i], dynos:-data[i+1]});
        }
        response.json(results);
    });
});
app.set('port', process.env.PORT || 5000);

server.listen(app.get('port'), function() {
  console.log('Express server listening on port ' + app.get('port'));
});
