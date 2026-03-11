const Mocha = require('mocha');
const fs = require('fs');
const glob = require('glob');

const mocha = new Mocha({ reporter: 'json' });
const files = glob.sync('test/**/*.test.ts');
files.forEach(f => mocha.addFile(f));

require('ts-node').register({ transpileOnly: true });

mocha.run(failures => {
  console.log("ACTUAL FAILURES COUNT: " + failures);
  process.exit(failures > 0 ? 1 : 0);
}).on('fail', function(test, err) {
  console.log("FAILED TEST: " + test.title);
  console.log("ERROR MESSAGE: " + err.message);
});
