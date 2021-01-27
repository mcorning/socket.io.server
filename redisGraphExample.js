const RedisGraph = require('redisgraph.js').Graph;

const today = { date: '1/26' };
const printJson = (json) => {
  console.log(JSON.stringify(json, null, 3));
};

const options = {
  host: 'redis-11939.c60.us-west-1-2.ec2.cloud.redislabs.com',
  port: 11939,
  password: '7B3DId42aDCtMjmSXg7VN0XZSMOItGAG',
};

const graph = new RedisGraph('sisters', null, null, options);

try {
  (() => {
    console.log('Creating graph...');
    const promises = [
      graph.query("CREATE (:visitor{name:'mpc',id:1}) "),
      graph.query("CREATE (:visitor{name:'katy',id:2})"),
      graph.query("CREATE (:visitor{name:'ship',id:3})"),
      graph.query("CREATE (:visitor{name:'renee',id:6})"),
      graph.query("CREATE (:room{name:'Fika',id:4})   "),
      //         CREATE (:room{name:'RES',id:1289)

      graph.query("CREATE (:room{name:'SCC',id:5})"),
      graph.query(
        "MATCH (a:visitor), (b:room) WHERE (a.name = 'mpc' AND b.name='Fika' ) CREATE (a)-[:visits{date:'1/26'}]->(b)",
        today
      ),
      graph.query(
        "MATCH (a:visitor), (b:room) WHERE (a.name = 'katy' AND b.name='Fika') CREATE (a)-[:visits{date:'1/26'}]->(b)"
      ),
      graph.query(
        "MATCH (a:visitor), (b:room) WHERE (a.name = 'ship' AND b.name='Fika') CREATE (a)-[:visits{date:'1/25'}]->(b)"
      ),
      graph.query(
        "MATCH (a:visitor), (b:room) WHERE (a.name = 'ship' AND b.name='SCC') CREATE (a)-[:visits{date:'1/26'}]->(b)"
      ),
      graph.query(
        "MATCH (a:visitor), (b:room) WHERE (a.name = 'renee' AND b.name='SCC') CREATE (a)-[:visits{date:'1/2'}]->(b)"
      ),
    ];

    Promise.all(promises).then(() => {
      // Match query.
      console.log('Graph created. Querying:');
      graph
        .query('MATCH  (a:visitor)-[visits]->(:room)  RETURN a.name ')
        .then((res) => {
          console.group('Fika visitors:');

          while (res.hasNext()) {
            let record = res.next();
            console.log(record.get('a.name'));
          }
          console.log(res.getStatistics().queryExecutionTime());
          console.groupEnd();
          console.log(' ');
        });

      // Match with parameters.
      let param = { id: 5 };
      graph.query('MATCH (a {id: $id}) return a.name', param).then((res) => {
        console.group('Print name of id 5:');
        while (res.hasNext()) {
          let record = res.next();
          console.log(record.get('a.name'));
        }
        console.groupEnd();
      });

      // Named paths matching.
      graph
        .query('MATCH p = (a:visitor)-[:visits]->(:room) RETURN p')
        .then((res) => {
          console.group('Graph:');

          while (res.hasNext()) {
            let record = res.next();
            let p = record.get('p');
            // See path.js for more path API.
            console.groupCollapsed(p.firstNode.properties.name);
            printJson(p);
            console.log(p.nodeCount);
            console.groupEnd();
          }
          console.groupEnd();

          graph.deleteGraph();
          graph.close();
        });
    });
  })();
} catch (err) {
  console.log(err);
}
