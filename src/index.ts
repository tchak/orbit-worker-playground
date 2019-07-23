import { Schema } from '@orbit/data';

import Worker from './worker';
import Main from './main';

const schema = new Schema({
  models: {
    author: {
      attributes: {
        name: {
          type: 'string'
        },
        birthplace: {
          type: 'string'
        }
      }
    }
  }
});

(async () => {
  // Setup Worker
  await Worker(schema);

  // Setup Main
  const memory = await Main(schema);

  // Query
  const records = await memory.query(q => q.findRecords('author'));

  console.log(records);
})();
