const fs = require('fs');
const path = require('path');
const csv = require('fast-csv');

const RedisGraph = require('redisgraph.js').Graph;
const options = {
  host: 'redis-11939.c60.us-west-1-2.ec2.cloud.redislabs.com',
  port: 11939,
  password: '7B3DId42aDCtMjmSXg7VN0XZSMOItGAG',
};

const graph = new RedisGraph('sisters', null, null, options);
const promises = [];
fs.createReadStream(
  path.resolve(__dirname, './', 'Sisters Business License Filtered Listing.csv')
)
  .pipe(csv.parse({ headers: true }))
  .on('error', (error) => console.error(error))
  .on('data', (row) => {
    if (row.NAME === 'LODG') {
      let x = `CREATE (:room{name:'${row.ID}',id:${row.CODE}})`;
      console.log(x);
      promises.push(graph.query(x));
    }
  })
  .on('end', (rowCount) => {
    console.log(`Parsed ${rowCount} rows`);
    Promise.all(promises).then(() => {
      let param = { id: 95 };
      graph.query('MATCH (a {id: $id}) return a.name', param).then((res) => {
        console.group('Print name of id 95:');
        while (res.hasNext()) {
          let record = res.next();
          console.log(record.get('a.name'));
        }
        console.groupEnd();
      });
    });
  });
