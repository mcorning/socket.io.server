# LCT socket.io.server

The is the server half of Local Contact Tracing.

This is a socket.io server for managing messages passed between Visitors and Rooms.

LCT client-side code is in this repo: [prototyping](https://github.com/mcorning/prototyping.git)

That repo contains two branches:

* **visitor**
* **room**

## Server Development Environment

To run the server in Visual Studio Code:

1. Open the `socket.io.server` folder
2. Select the Explorer from the Side Bar
3. Start the server 
   1. from NPM SCRIPTS (if visible)
   2. from the Terminal with the command `node server`

## Server Production Environment

To remote into the Ubuntu VM:
 
 1. Select the Ubuntu.rdp from the file list
 2. Select option Reveal in File Explorer
 3. Double click the Ubuntu.rdp

You should see three windows:

  ![Ubuntu Remote](./docs/Ubuntu%20Remote.jpg)

  ### Git

  Use one window to pull the latest build from the repo. Because the server is running under nodemon, each new pull restarts the server.

  ### NodeJS

  Use the other window to run the server using this command:
  
  `nodemon server`
  
  Click the link at the bottom of this window to see the web app that gives you access to working client code.

## Files

Server code is in the `server.js` and `radar.js` files.

### Server.js

There are four basic sections of server code.

* Express code (so we can render web pages)
* Socket.io Server initialization (see below)
* Server Proxy (so server can use radar.js)
* Socket.io Server code (where all the good stuff is)

In order to communicate with Rooms and Visitors, we stipulate socket ID values and map them to public names for Rooms and nicknames for Visitors. We do this by overriding the `io.engine.generateId()` method. We also utilize socket.io middleware with the `io.use()` method.

The Socket.io Server code has two responsiblities:

* It handles messages from the Visitor and Room user interfaces
* It implements the COVID-19 Virus Alert Protocol

#### Protocol

The protocol consists in five steps:
1. `stepOneWarningFromVisitor`
2. `stepTwoServerNotifiesRoom`
3. `stepThreeServerFindsExposedVisitors`
4. `stepFourServerAlertsVisitor`
5. `stepFiveVisitorReceivedAlert`

### Radar.js

The radar.js code wraps the socket.io interfaces. As its name implies, radar.js can do complicated or subtle things for you merely by asking. For example, it offers a `sockets` property that uses a complex query to render relevant socket data. It also has an `openRooms()` property that joins data from the socket.io interface.