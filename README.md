# eb-runrate

A simple [EventBus](https://github.com/heroku/eventbus) consumer example in Node.js.
Connects to the `api-events` stream on the Event Bus, and waits for 
[formation](https://github.com/scottpersinger/eb-runrate/blob/master/index.js#L52)
update events which indicate dyno scaling events. The current dyno usage is stored
in Redis with the total dyno count. A leaderboard of apps by total dynos is also
kept in Redis in a sorted set. 

The [node process](index.js) supports a single `/topapps` endpoint which returns the current
leaderboard. The [index](static/index.html) html page queries the leaderboard every few seconds
and draws the leaderboard as a word cloud.

![Screenshot](/static/screenshot.png)

![Interaction Diagram](http://www.plantuml.com/plantuml/proxy?src=https://raw.githubusercontent.com/scottpersinger/eb-runrate/master/eb-interact.txt&arg=1)
