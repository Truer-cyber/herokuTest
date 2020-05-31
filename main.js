var fs = require('fs'),
		http = require('http');

var users = {};
const colors = ['#000000','#FFFFFF','#990000','#000099','#999999','#FFAAAA','#009900','#FF00AA','#00AAFF','#990099','#FFFF00','#FFAA00','#FFFFFF88','#6A3805','#D7D7D7','A9B137'];
const chargeMax=50;
var canvas = [[{color:colors[0],clicked:0}]];
var canvasSize = 1;
var pixelsLeft = 1;
const port = process.env.PORT || 8080;

// Gets a user for a given IP. Users are {IP, LastEditedAt, EXP} pairings
function getUser(ip) {
	console.log(users);
	// In the future, this will be a database lookup.
	if (users[ip]) {
		return users[ip];
	} else {
		let newUser = {IP:ip, LastEditedAt:0, EXP:0};
		users[ip] = newUser;
		return newUser;
	}
}

const server = http.createServer(function (req, res) {
	console.log(req.url);
	let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	console.log(ip);
	// 
	if (req.method == "GET") {
		console.log(req.url);
		fs.readFile(__dirname + '/static/index.html', function (err,data) {
			if (err) {
				res.writeHead(404);
				res.end(JSON.stringify(err));
				return;
			}
			res.writeHead(200);
			res.end(data);
		});
	} else {
		// All non-get requests are assumed to be draw requests
		// For the sake of simplicity.
		let user = getUser(ip);
		// If EXP reaches a threshold, let the user know in the response by sending them a color.
		let time = new Date().getTime();
		if ((time) > (user.LastEditedAt+chargeMax*.9)) { // Some leeway.
			// In the final version, this will be a database call.
			//
			let body = '';
			console.log('non-get');
			req.on('data', function(data) {
				body+= data;
				if (body.length>10000) {
					res.writeHead('413');
					res.end('413');
				}
			});
			req.on('end', function() {
				let resBody = {users:users};
				try {
					let j = JSON.parse(body);
					console.log(j);
					// Set the color
					j.c=(j.c<=Math.sqrt(user.EXP))?colors[j.c]:colors[0];
					drawPix(j);
					//
					user.LastEditedAt = time;
					let temp = Math.sqrt(++user.EXP);
					if ((temp%1==0)&&(temp<colors.length)) {
						resBody.color = colors[temp];
					}
				} catch(err) {
					console.log(err);
				} finally {
					res.writeHead('200');
					res.end(JSON.stringify(resBody));
				}
			});
		} else { // Insufficient time has passed since the last submission.
			res.writeHead('200');
			res.end('200');
		}
	}
	//
})

const io = require('socket.io')(server);

function expandCanvas() {
	// In the final version, this will update the database.
	let newRow = [];
	for (let i=0;i<canvasSize;i++) {
		canvas[i].push({color:colors[(i+canvasSize)%2], clicked:0});
		newRow.push({color:colors[(i+canvasSize)%2], clicked:0});
	}
	newRow.push({color:colors[(canvasSize+canvasSize)%2], clicked:0});
	canvas.push(newRow);
	canvasSize++;
	pixelsLeft=canvasSize*2-1;
	// Broadcast the new canvas
	io.emit('canvas', {canvas:canvas});
}

// Handle requests from this client.
function drawPix(data) {
	let x = data.x;
	let y = data.y;
	let c = data.c;
	if ((x<canvasSize)&&(y<canvasSize)&&(canvas[y][x].color!=c)) {
		let g = canvas[y][x];
		g.color=c;
		io.emit('broadcastPix', {
			x:x,
			y:y,
			c:c
		});
		// Expand the canvas if the last pixel has been clicked
		console.log(g);
		if (g.clicked==0) {
			g.clicked=1;
			if (--pixelsLeft == 0) {
				expandCanvas();
			}
		}
		console.log(pixelsLeft);
		
	}
}

io.on('connection', socket => {
	console.log("Connection established with "+socket.handshake.address+".");
	// socket.emit => to one client
	// io.emit => to all clients
	// 
	let user = getUser(socket.handshake.address);
	socket.emit('canvas', {canvas:canvas, chargeMax:chargeMax,
		addr: socket.handshake.address,
		endpt: socket.handshake.headers['x-forwarded-for'],
		ra: socket.request.connection.remoteAddress,
		colors:colors.slice(0,Math.floor(Math.sqrt(user.EXP)+1))});
	// disconnections
	socket.on('disconnect', () => {
		console.log("Connection lost.");
	});
});

server.listen(port);
