#!/usr/bin/env node
var fs          = require('fs'),
    http        = require('http'),
    express     = require('express'),
    app         = express(),
    WebSocket   = require('faye-websocket'),
    redisMod    = require("redis"),
    redis       = redisMod.createClient(process.env['REDIS_URL']),
    server      = http.createServer(app);

app.use(express.static('static'));

LEADERBOARD_LIMIT = 30

function connect_eventbus(initial_offsets) {
    EVENTBUS_SOCKET_URL = "wss://eventbus-sub.api.herokai.com";

    var client = new WebSocket.Client(EVENTBUS_SOCKET_URL);

    client.on('error', function(error) {
        console.log('Connection Error: ', error);
    });
     
    client.on('open', function(event) {
        console.log('WebSocket Client Connected');
        client.on('close', function() {
            console.log('WS Connection Closed');
        });

        // utils
        function expect_status(expected_status, callback) {
            client.on('message', function(event) {
                var payload = JSON.parse(event.data);
                if (payload['status'] == expected_status) {
                    console.log("Received " + expected_status);
                    callback(payload);
                }
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
            var formation = {};

            // Update combined app formation in Redis, and sum up dyno total
            redis.get(app + "/formation", function(err, payload) {
                if (!err && payload) {
                    formation = JSON.parse(payload);
                }
                formation.timestamp = message.updated_at;
                if (formation.dynos == undefined) {
                    formation.dynos = {}
                }
                formation.dynos[message.data.size] = message.data.quantity;

                // Total up dynos of all sizes
                var total = 0;
                for (var k in formation.dynos) {
                    total += formation.dynos[k];
                    redis.zadd(['topapps',-total,app])
                    redis.zremrangebyrank(['topapps', LEADERBOARD_LIMIT, -1])
                }
                redis.set(app + "/formation", JSON.stringify(formation));
            });
        }

        var partition_offsets = {};


        // EventBus protocol
        //
        // Once we open the websocket, then there is a message exchange to setup our
        // subscriber. The server will send message packets with a 'state'
        // attribute indicating the current handshake state.
        //
        // open ->
        //   ready ->
        //     [send stream, authentication, partition positions]
        //     streaming -->
        //       message -->
        //         [handle event message]
        expect_status('ready', function(payload) {
            var connection_id  = payload["id"];
            var stream         = 'api-events';
            var authentication = process.env['EB_AUTH'];

            console.log("Subscribing to " + stream);

            client.send(JSON.stringify({
                      client:'Eb-Runrate', 
                      version:'0.1', 
                      id: connection_id,
                      stream:stream, 
                      authentication:authentication, 
                      state:initial_offsets ? new Buffer(initial_offsets).toString("base64") : null}
                      ));

            expect_status('streaming', function(payload) {

                console.log("STARTING STREAM LISTENER...");
                client.on('message', function(event) {
                    var payload = JSON.parse(event.data);
                    partition_offsets[payload.partition] = payload.offset;
                    save_offsets(partition_offsets);

                    var message = payload.body;
                    if (is_formation(message)) {
                        process_formation(message);
                    }
                });

            });
        });

    });

}

// == Setup Redis

redis.on("error", function (err) {
    console.log("Redis error " + err);
});

redis.get("__partition_offsets", function(err, initial_offsets) {
    // Connect to the EventBus
    connect_eventbus(initial_offsets);
});

// == Setup Express API to return top apps

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
