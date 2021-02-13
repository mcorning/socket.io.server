const IO_CLIENT = require('socket.io-client');
const URL = 'https://53f79f608916.ngrok.io';

console.log('starting connection to  ', URL);

//connect() is what makes things happen
let socket = IO_CLIENT.connect(URL);
socket.on('error', function (evData) {
  console.error('Connection Error:', evData);
});
// 'connected' is our custom message that let's us know the user is connected
socket.on('connect', () => {
  console.log('Socket connected (client side) on:', socket.id);
});
