const mongoose = require('mongoose');

const password = require('./pass.json');
const connectionString = 'mongodb+srv://myAdmin:'+password.password+'@cluster0-wytj9.mongodb.net/<dbname>?retryWrites=true&w=majority';

const connector = mongoose.connect(connectionString);

const user = require('./userSchema.js');
const User = mongoose.model('user', user, 'user');

const canvas = require('./canvasSchema.js');
const Canvas = mongoose.model('canvas', canvas, 'canvas');

// Server
var fs = require('fs'),
		http = require('http');
const port = process.env.PORT || 8080

// Specific variables
const cooldown = 50;
const colors = ['#000000','#FFFFFF','#990000','#000099','#999999','#FFAAAA','#009900','#141414','#FF00AA','#00AAFF','#990099','#FFFF00','#FFAA00','#FF0000','#00FF00','#0000FF','#FFFFFF88','#6A3805','#D7D7D7','#A9B137','#488000'];

var users = {}; // Maps IPs to click counts and last-clicked times
var grid = false; // 
var clicksLeft;
var pixelsLeft = Infinity;

// Get a user, either from the cache or the DB.
async function getUser(ip) {
	if (users[ip]) {
		return users[ip];
	}
	// Get or create a User
	let query = {};
	let update = {};
	let res = await User.findOne({ipAddress: ip});
	if (!res) { res = await new User({ipAddress: ip}).save(); }
	// Add the user to our cache for future reference.
	users[ip] = {clicks: res.clicks, lastClicked: 0};
	return users[ip];
}

//
async function growCanvas() {
	let l = grid.length;
	let newLine = [];
	for (let i=0; i<l; i++) {
		let x = '#488000';//colors[(l+i+1)%2];
		grid[i].push(x);
		newLine.push('#488000');//colors[(l+i+1)%2]);
	}
	newLine.push('#488000');//colors[(l*2+1)%2]);
	grid.push(newLine);
	// Broadcast the new canvas to all users
	broadcastCanvas(grid); // SOCKETIO INTEGRATION
	//
	clicksLeft = l**2;//(l+1)*2-1;
	// Update the stored grid
	await Canvas.findOneAndReplace({}, { "grid": grid, "clicksLeft": clicksLeft});
}

// Gets the canvas
async function getCanvas() {
	if (grid) {return grid;}
	// Get canvasSchema.grid, or create one if it doesn't exist
	let c = await Canvas.findOne({});
	if (!c) { c = await new Canvas().save(); } 
	c = c.toObject();
	clicksLeft = c.clicksLeft;
	grid = c.grid;
	return grid;
}

// Update the canvas with a pixel change, and add a click to the relevant user
async function updateCanvas(ip, x, y, c) {
	// Check if the user can click yet
	let u = await getUser(ip);
	let t = new Date().getTime();
	if (u.lastClicked + cooldown*.95 < t) {
		let cv = await getCanvas();
		let gs = cv.length;
		if ((c**2<=u.clicks) && (c<colors.length) && (x<gs) && (y<gs) && (x>=0) && (y>=0)) {
			// Broadcast the update
			drawPix(x,y,c); // SOCKETIO INTEGRATION
			// Update the canvas
			cv[y][x]=colors[c];
			clicksLeft--;
			let update = { 
				$set: {},
				$inc: { "clicksLeft": -1 } 
			}
			update.$set["grid."+y+"."+x] = colors[c];
			await Canvas.findOneAndUpdate({}, update); // conditions, update
			// Add a click to the user
			u.clicks++;
			await User.findOneAndUpdate({'ipAddress': ip}, { $inc: {"clicks":1}});
			// Handle canvas growth
			if (clicksLeft <= 0) {
				await growCanvas();
			}
		}
	}
}

/*

	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Create the server

*/
//*
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
		// Parse the request body
		let body = '';
		console.log('non-get');
		req.on('data', function(data) {
			body+= data;
			if (body.length>10000) {
				res.writeHead('413');
				res.end('413');
			}
		});
		// We now have the full request.
		req.on('end', async function() {
			let resBody = {};
			try {
				let u = await getUser(ip);
				console.log(u);
				let j = JSON.parse(body);
				console.log(j);
				// Update the canvas and the database
				await updateCanvas(ip, j.x, j.y, j.c);
				//
				let temp = Math.sqrt(u.clicks);
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
	}
});
//*/
/*
	Sockets
*/
//*
const io = require('socket.io')(server);

function drawPix(x,y,c) {
	io.emit('broadcastPix', {
		x:x,
		y:y,
		c:c
	});
}

function broadcastCanvas(grid) {
	// Broadcast the new canvas
	io.emit('canvas', {canvas:grid});
}

io.on('connection', async (socket) => {
	console.log("Connection established with "+socket.handshake.address+".");
	// socket.emit => to one client
	// io.emit => to all clients
	let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
	let user = await getUser(ip);
	console.log('f');
	let g = await getCanvas();
	console.log(user);
	console.log(g);
	socket.emit('canvas', {
		canvas:g, 
		chargeMax:cooldown,
		colors:colors.slice(0,Math.floor(Math.sqrt(user.clicks)+1))
	});
	// disconnections
	socket.on('disconnect', () => {
		console.log("Connection lost.");
	});
});
//*/
/*

	Run the server

*/

//*
server.listen(port);
console.log('Listening on port: '+port);
//*/

/*

	For testing purposes; not used in production.

*/

;(async () => {
  	// Clear user and canvas
  	/*
  	//await User.deleteMany({});
  	//await Canvas.deleteMany({});
  	console.log("DB cleared.");
	console.log('a');
  	// Create a new user
  	let u1 = await getUser("userA");
  	// Create another new user
  	let u2 = await getUser("userB");
  	
  	// Clear the user cache
  	users = {}; 

  	// Have the second user update the canvas at 1,1
  	await updateCanvas("userB", 1, 1, 0)
  	
  	// Print the contents of everything
  	console.log('User contents');
  	let temp = await User.find({});
  	console.log(temp);
  	console.log('Canvas contents');
  	temp = await Canvas.find({});
  	console.log(temp);
  	console.log(temp[0].grid[0]);
  	console.log(temp[0].grid[1]);
  	console.log(grid);
  	console.log(clicksLeft);
  	var s = await findUser('bob');

	const server = http.createServer((req, res) => {
		res.statusCode = 200;
		res.setHeader('Content-Type', 'text/html');
		res.end('<h1>Hello World</h1>' + '<br>' + s);
	});

	server.listen(port,() => {
		console.log(`Server running at port `+port);
	});
	

	process.exit();
	//*/
})();
