//HOST = '192.168.10.146'; // localhost
HOST=null;
PORT = 645;

// when the daemon started
var starttime = (new Date()).getTime();

var mem = process.memoryUsage();
// every 10 seconds poll for the memory.
setInterval(function () {
  mem = process.memoryUsage();
}, 10*1000);


var fu = require("./fu"),
    sys = require("sys"),
    url = require("url"),
    qs = require("querystring");


var sessions = {};
var players = {};		// Public player list
var player_queue = [];			// Internally used
var player_one = null;
var player_two = null;
var player_one_throw = null;
var player_two_throw = null;
var game_active = false;

// Timestamp queues
var chat_box = [];
var event_list = [];

var error_queue={};

setInterval(function () {
	var mark=(new Date().getTime()-3000);
	for(key in players) {
		if(players[key].ping<mark) {
			playerLeave(key);
		}
	}
	for (var i = 0; i < event_list.length; i++) {
		var ev = event_list[i];
		if (ev && ev.timestamp < mark) {
			delete event_list[i];
		}
	}
}, 1000);

fu.listen(Number(process.env.PORT || PORT), HOST);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/styles.css", fu.staticHandler("styles.css"));
fu.get("/jquery-1.8.1.min.js", fu.staticHandler("jquery-1.8.1.min.js"));
fu.get("/img/p1-waiting.gif", fu.staticHandler("img/p1-waiting.gif"));
fu.get("/img/p1-rock.gif", fu.staticHandler("img/p1-rock.gif"));
fu.get("/img/p1-paper.gif", fu.staticHandler("img/p1-paper.gif"));
fu.get("/img/p1-scissors.gif", fu.staticHandler("img/p1-scissors.gif"));
fu.get("/img/p2-waiting.gif", fu.staticHandler("img/p2-waiting.gif"));
fu.get("/img/p2-rock.gif", fu.staticHandler("img/p2-rock.gif"));
fu.get("/img/p2-paper.gif", fu.staticHandler("img/p2-paper.gif"));
fu.get("/img/p2-scissors.gif", fu.staticHandler("img/p2-scissors.gif"));
fu.get("/api", function (req, res) {
	var action = getAjaxData(req,'action');
	var data = {};

	var id=getAjaxData(req,'id');

	switch(action) {

		case 'getstate':
			var player_list = [];
			var new_chat=[];
			var since=getAjaxData(req,'since');
			var eq_delete=null;
			var events=[];
			
			var now=new Date().getTime();
			
			for(key in players) {
				if (key==id) {
					players[key].ping=now;
				}

				if(key in players) player_list.push(players[key].nick);
			}
			data.errortext='';
			for (key in error_queue) {
				if (id==key) {
					data.errortext=error_queue[key];
					eq_delete=id;
				}
			}
			if (eq_delete) { delete error_queue[eq_delete]; }

			var p1=p2 = 'Empty Spot';
			if(game_active) {
				//console.log([player_one, player_two]);
				var p1 = players[player_one].nick;
				var p2 = players[player_two].nick;
			}
			
			// chat events
			for (var i = 0; i < chat_box.length; i++) {
			  var message = chat_box[i];
			  if (message.timestamp > since) {
			  	colon = ':';
			  	cls = '';
			  	if(message.nick=='') {
			  		colon = '';
			  		cls = 'msg';
			  	} else if ((id>0) && (id in players) && (message.nick==players[id].nick)) {
			  		cls = 'mine';
			  	}

			  	new_chat.push('<li class="'+ cls +'"><span>'+message.nick+colon+'</span> <span>'+message.text+'</span></li>');
			  }
			}
			
			// game events
			for (var i = 0; i < event_list.length; i++) {
				var ev = event_list[i];
				if (ev && ev.timestamp > since) {
					if (ev.target=='all') {
						events.push(ev.data);
					} else if (ev.target==id) {
						events.push(ev.data);
					}
				}
			}

			data.player_one = p1;
			data.player_two = p2;
			data.player_list = player_list;
			data.events=events;
			data.chat=new_chat;
			
		break;

		case 'join':
			console.log('join');
			var name=getAjaxData(req,'name');

			// check for unique and such here
			var id=Math.floor(Math.random()*99999999999).toString();
			while (id in players) {
				id=Math.floor(Math.random()*99999999999).toString();
			}

			players[id]={nick: name, ping: new Date().getTime()};
			data = {id:id};
			player_queue.push(id);
			canWeStartTheGame();
		break;

		case 'leave':
			playerLeave(id);
		break;

		case 'throw':
			if (!game_active) { return; }
			var move=getAjaxData(req,'gesture');
			if (id==player_one) {
				var gidx=gestureIndex(move);
				if (gidx && !player_one_throw) {
					player_one_throw=gidx;
					console.log(players[id].nick+' threw '+move);
					pushEvent({
						data: ['throw',1]
					});
				}
			} else if (id==player_two) {
				var gidx=gestureIndex(move);
				if (gidx && !player_two_throw) {
					player_two_throw=gidx;
					console.log(players[id].nick+' threw '+move);
					pushEvent({
						data: ['throw',2]
					});
				}
			}

			if (player_one_throw && player_two_throw) {
				console.log('resolve '+compareGestures(player_one_throw,player_two_throw));
				var result=compareGestures(player_one_throw,player_two_throw);
				if(result==0) {
					pushEvent({
						data: ['tie']
					});
					player_one_throw=null;
					player_two_throw=null;
				} else {
					gameFinish(result);	
				}
			}
		break;
		
		case 'msg':
			if (!(id in players)) { return; }
			var text=getAjaxData(req,'text');
			
			if (text.substring(0,1)=='/') {
				var parse_array=text.split(/\/(.+?)\b/);
				var op=parse_array[1];
				var param_str=parse_array[2].trim();
				var params=param_str.split(' ');
				switch (op) {
					case 'me':
						addMessage({
							text: players[id].nick+' '+param_str,
						});
					break;
					case 'fudge':
						addMessage({
							nick: params[0],
							text: params.slice(1,params.length).join(' '),
						});
					break;
					case 'rq':
						addMessage({
							text: players[id].nick+' is so over this stupid game.',
						});
					break;
				}
				//chat_box.push(message);
				
			} else {			
				addMessage({
					nick: players[id].nick,
					text: text,
				});
			}			
			
		break;
	}
	res.simpleJSON(200, data);
});

function addMessage(opts) {
	var defaults={
		type:1,
		timestamp: (new Date()).getTime(),
		nick: '',
		text: ''
	};
	var message = extend({}, defaults, opts);
	chat_box.push(message);
}

function pushEvent(opts) {
	var defaults={
		data: '',
		target: 'all',
		timestamp: (new Date()).getTime()
	};
	if (opts.category) { opts.category=[opts.category]; }
	var ev = extend({}, defaults, opts);
	console.log('Pushing event with data '+ev.data+ ' to id '+ev.target);
	event_list.push(ev);
}

function apiError(id,text) {
	if (id in error_queue) {
		error_queue[id]+='\n'+text;
	} else {
		error_queue[id]=text;
	}
}

function compareGestures(g1,g2){
	if (g1==g2) { return 0; }
	if (g1==1) {
		return (g2==2) ? player_two : player_one;
	} else if (g1==2) {
		return (g2==3) ? player_two : player_one;
	} else if (g1==3) {
		return (g2==1) ? player_two : player_one;
	}
}

function gestureIndex(gesture) {
	switch(gesture) {
		case 'rock': return 1;
		case 'paper': return 2;
		case 'scissors': return 3;
	}
	return false;
}

function playerLeave(id) {
	var idx = player_queue.indexOf(id); // Find the index
	if(idx!=-1) player_queue.splice(idx, 1); // Remove it if really found!

	delete players[id];

	if(id==player_one || id==player_two) {
		gameFinish((id==player_one) ? player_two : player_one);
	}
}

function gameFinish(player) {
	
	game_active = false;
	console.log(players[player].nick+' wins');
	chat_box.push({nick: '', text: players[player].nick+' wins', timestamp: (new Date()).getTime()});

	player_queue.unshift(player);

	if(player==player_one) {
		pushEvent({
			data: ['finish',1,player_one_throw,player_two_throw]
		});
		if(player_two in players) player_queue.push(player_two);
	} else {
		pushEvent({
			data: ['finish',2,player_one_throw,player_two_throw]
		});
		if(player_one in players) player_queue.push(player_one);
	}

	player_one = null;
	player_two = null;
	player_one_throw=null;
	player_two_throw=null;
	console.log('END');

	canWeStartTheGame();
}

function canWeStartTheGame() {
	if(game_active) return;
	console.log(player_queue);
	if(player_queue.length>1) {
		console.log('START');
		game_active = true;
		player_one = player_queue.shift();
		player_two = player_queue.shift();
		
		pushEvent({
			data: ['playing',1],
			target: player_one
		});
		
		pushEvent({
			data: ['playing',2],
			target: player_two
		});
		
		pushEvent({
			data: ['newgame',players[player_one].nick,players[player_two].nick]
		});
	}
}

function getAjaxData(req,key) {
	return qs.parse(url.parse(req.url).query)[key];
}

function extend() { // Thanks jQuery
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
		target = {};
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};























































/*
function onRequest(request, response) {
	var pathname = url.parse(request.url).pathname;
	var output = '';
  console.log("Request for " + pathname + " received.");

	switch(pathname) {
		case '/':
			output = 'home';
		break;

		case '/join':

			var nick = 'boobs';//qs.parse(url.parse(req.url).query).nick;
		  var session = createSession(nick);
//  channel.appendMessage(session.nick, "join");
  		res.simpleJSON(200, { id: session.id
                      , nick: session.nick
                      , rss: mem.rss
                      , starttime: starttime
                      });
});



		break;

		case '/getlist':
			output = users.join(',');
		break;

		case '/getstate':
			output = player_one_throw+', '+player_two_throw;
		break;
	}

	response.writeHead(200, {"Content-Type": "text/plain"});
	response.write(output);
	response.end();
}












function createSession (nick) {
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick) return null;
  }

  var session = { 
    nick: nick, 
    id: Math.floor(Math.random()*99999999999).toString(),
    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      channel.appendMessage(session.nick, "part");
      delete sessions[session.id];
    }
  };

  sessions[session.id] = session;
  return session;
}*/