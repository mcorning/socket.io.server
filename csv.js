const fs = require('fs');
const csv = require('fast-csv');

const RedisGraph = require('redisgraph.js').Graph;
const options = {
  host: 'redis-11939.c60.us-west-1-2.ec2.cloud.redislabs.com',
  port: 11939,
  password: '7B3DId42aDCtMjmSXg7VN0XZSMOItGAG',
};
const graph = new RedisGraph('sisters', null, null, options);

const visitors = require('./visitors.json');

const filter = '';
const printJson = (json) => {
  console.log(JSON.stringify(json, null, 3));
};

const getRooms = () => {
  if (!filter) {
    return;
  }
  const promises = [];
  let id;
  fs.createReadStream('./Sisters Business License Filtered Listing.csv')
    .pipe(csv.parse({ headers: true }))
    .once('data', () => {
      console.group('Rooms:');
    })
    .on('error', (error) => console.error(error))
    .on('data', (row) => {
      if (row.NAME === filter) {
        let x = `CREATE (:room{name:"${row.ID}",id:${row.CODE}})`;
        console.log(x);
        promises.push(graph.query(x));
        if (promises.length == 7) {
          id = row.CODE;
        }
      }
    })
    .on('end', (rowCount) => {
      console.log(`Parsed ${rowCount} rows`);
      console.log(`Adding ${promises.length} nodes to graph`);
      Promise.all(promises).then(() => {
        graph.query(`MATCH (a {id: ${id}}) return a.name`).then((res) => {
          console.group(`Print name of id ${id}:`);
          while (res.hasNext()) {
            let record = res.next();
            console.log(record.get('a.name'));
          }
          console.groupEnd();
        });
        console.log('Creating Visitors');

        getVisitors();
      });
      console.groupEnd();
    });
};

// visitors
const getVisitors = () => {
  console.log(' ');
  console.group('Visitors:');
  const allVisitors = [];
  visitors.forEach((visitor) => {
    let x = `CREATE (:visitor{name:"${visitor.name}",id:${visitor.id}})`;
    console.log(x);
    allVisitors.push(graph.query(x));
  });
  Promise.all(allVisitors).then(() => {
    graph.query(`MATCH (v:visitor) RETURN v.name`).then((res) => {
      while (res.hasNext()) {
        let record = res.next();
        console.log(record.get('v.name'));
      }
      console.groupEnd();
    });
    console.log('Creating visits');

    // getVisits();
  });
};

// Visits
const getVisits = () => {
  if (!filter) {
    return;
  }
  console.log(' ');
  console.group('Visits:');
  const allVisits = [];
  const roomIds = [95, 1131, 1502];
  const date = '1/27';
  visitors.forEach((visitor) => {
    let x = `MATCH (a:visitor), (b:room) WHERE (a.name = "${
      visitor.name
    }" AND b.id=${
      roomIds[allVisits.length]
    } ) CREATE (a)-[:visits{date:"${date}"}]->(b)`;
    console.log(x);
    allVisits.push(graph.query(x));
  });
  Promise.all(allVisits).then(() => {
    graph
      .query(`MATCH p = (a:visitor)-[:visits]->(:room) RETURN p`)
      .then((res) => {
        while (res.hasNext()) {
          let record = res.next();
          printJson(record.get('p'));
        }
        console.groupEnd();
      });
    console.log('End of graph generation');
  });
};

const getAlerts = () => {
  // Visits
  console.log(' ');
  console.group('Alerts:');

  graph
    .query(
      `MATCH (a1:visitor)-[:visits]->(r:room)<-[:visits]-(a2:visitor) WHERE a1.name = 'mpc' AND a2.name <> 'mpc' RETURN a2.name, r.name`
    )
    .then((res) => {
      while (res.hasNext()) {
        let record = res.next();
        console.log(
          record.get('a2.name'),
          'was exposed at',
          record.get('r.name')
        );
      }
      console.groupEnd();
      console.log('End of alerts');
    });
};

console.log('Creating Rooms from csv');
getRooms();
getVisits();
getAlerts();

// if we store these output Cypher commands in a text file, we can bulk import them into Redis
// run this command in the terminal (outside of redis-cli)
// cat sistersCommands.txt | redis-cli --pipe

// or see https://github.com/RedisGraph/redisgraph-bulk-loader for the python way...

//#region Cheatsheet
/*
See all RELATIONSHIPs:
MATCH p=()-[*]->() RETURN p

See specified RELATIONSHIP
MATCH  (a:visitor{id:1})-[:visits]->(:room) RETURN a.id, a.name


CREATE a RELATIONSHIP between MATCHed nodes:
MATCH (a:visitor), (b:room) WHERE (a.name = "" AND b.name="" ) CREATE (a)-[:visits]->(b)


Filter RELATIONSHIP based on its propertyL
MATCH p=(visitor{name:'klm'})-[*]-() WHERE any(edge IN relationships(p) WHERE edge.date>=\"1/27\") RETURN p



DELETE relationship:
MATCH  (:room{name:"The Den of the Ogre King"})-[c:connects_to]->(:room{name:"The Antechamber of the Ogre King"}) DELETE c

SET property on relationship:
MATCH  (:room{name:"The Secret Room of the Ogre King"})-[c:contains]->(:monster{name:"Ralph the Ogre King"}) SET c.visible="0"

Exposed Visitors:
MATCH (a1:visitor)-[:visits]->(r:room)<-[:visits]-(a2:visitor) WHERE a1.name = 'mpc' AND a2.name <> 'mpc' RETURN a2.name, r.name
*/
//#endregion
