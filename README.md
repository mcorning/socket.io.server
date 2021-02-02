# socket.io.server

The is the server half of Local Contact Tracing.

This is a socket.io server for managing messages passed between Visitors and Rooms.

## Development Environment

To run the server in Visual Studio Code:

1. Open the socket.io.server folder
2. Select the Explorer from the Side Bar
3. Start the server 
   1. from NPM SCRIPTS (if visible)
   2. from the Terminal with the command `node .`

## Production Environment

To remote into the Ubuntu VM:
 
 1. Select the Ubuntu.rdp from the file list
 2. Select option Reveal in File Explorer
 3. Double click the Ubuntu.rdp

You should see three windows:

  ![Ubuntu Remote](./docs/Ubuntu%20Remote.jpg)

  Use the top left window to pull the latest build from the repo.

  This will restart the server.js file in the left window.

  You can see the client access points in the browswer.

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

