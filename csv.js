const fs = require('fs');
const csv = require('fast-csv');

const RedisGraph = require('redisgraph.js').Graph;
const options = {
  host: 'redis-11939.c60.us-west-1-2.ec2.cloud.redislabs.com',
  port: 11939,
  password: '7B3DId42aDCtMjmSXg7VN0XZSMOItGAG',
};

const graph = new RedisGraph('sisters', null, null, options);
const filter = 'LODG';
if (filter) {
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
      });
      console.groupEnd();
    });
}

// visitors
console.log(' ');
console.group('Visitors:');
const visitors = require('./visitors.json');
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
});
