# eb-runrate

A simple [EventBus](https://github.com/heroku/eventbus) consumer example in Node.js.
Connects to the `api-events` stream on the Event Bus, and waits for `formation`
update events which indicate dyno scaling events. The current dyno usage is stored
in Redis with the total dyno count. A leaderboard of apps by total dynos is also
kept in Redis in a sorted set. 

The node process supports a single `/topapps` endpoint which returns the current
leaderboard. The index html page queries the leaderboard every few seconds
and draws the leaderboard as a word cloud.

![Screenshot](/static/screenshot.png)

