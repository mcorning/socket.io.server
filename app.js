var express = require('express');
var app = express();

var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});

let rooms = new Map();
let visitors = new Map();

// This server handles messages from Rooms and Visitors
// Rooms
// Room comes onine and gets connected to server
// Room's mounted lifecycle method updates the server with its Room ID and the 'open' event
// NOTE: Rooms may be managed by a person. If so, they may be subject to an exposure alert (or they may trigger one)

io.on('connection', function (socket) {
  visitors.set(socket.id, '');
  console.log(socket.id, 'connected');

  // Rooms
  socket.on('open', function (data, cb) {
    cb({
      msg: `Stay safe today, ${data}`,
      socketId: socket.id,
    });
    socket.join(data);
    console.log(data, 'opening');
    rooms.set(socket.id, data);
    console.log('ROOMS:', rooms);
  });

  socket.on('close', function (data, cb) {
    cb({
      msg: `Well done, ${data.roomId}`,
      socketId: socket.id,
    });
    socket.leave(data.roomId);
    console.log(data, 'closing.');
    rooms.set(socket.id, data.roomId);
  });

  // Visitors
  socket.on('visit', function (data, cb) {
    cb({
      msg: `Welcome to ${data.roomId}, ${data.yourId}.`,
      socketId: socket.id,
    });
    socket.join(data.roomId);
    io.to(data.roomId).emit('entered');
    console.log(data, 'visited');
    visitors.set(socket.id, data.yourId);
    socket
      .to(data.roomId)
      .emit('newVisitor', {
        visitor: data.yourId,
        sentTime: data.sentTime,
        message: 'Visiting',
      });
  });

  socket.on('leave', function (data, cb) {
    cb(`See you next time, ${data}`);
    socket.leave(data.roomId);
    console.log(visitors.get(socket.id), 'has left the building');
  });

  socket.on('removeRoom', () => {
    rooms.delete(socket.id);
    socket.disconnect();
  });
  socket.on('removeVisitor', () => {
    visitors.delete(socket.id);
    socket.disconnect();
  });

  socket.on('disconnecting', () => {
    const rooms = Object.keys(socket.rooms);
    // the rooms array contains at least the socket ID
    console.log('Sockets rooms', rooms);
  });

  // socket.emit('newMessage', 'I am here');

  // socket.on('newMessage', function (msg) {
  //   console.info('new message', msg);
  //   if (msg.message == 'alert') {
  //     console.error(msg.visitor + 'is quarantived on', msg.sentTime);
  //   }
  //   io.emit('newMessage', msg);
  // });

  // // called when Visitor changes Room dropdown
  // socket.on('joinRoom', (data) => {
  //   console.log(data);
  //   socket.join(data);
  //   io.to(data).emit('newMessage', 'Welcome our new visitor');
  // });

  // // Called inside room.created(),
  // socket.on('addRoom', (data) => {
  //   console.log(data);
  //   rooms.push(data);
  //   socket.emit('addedRoom', { numRooms: rooms.size, roomId: data });
  // });
});

http.listen(port, function () {
  console.log('listening on *:' + port);
});
