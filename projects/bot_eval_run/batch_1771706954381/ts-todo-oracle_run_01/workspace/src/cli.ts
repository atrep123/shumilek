declare const require: any;
declare const process: any;
const fs = require('node:fs');
import TaskStore from './store';

const argv = process.argv.slice(2);
const command = argv[0];
const dataPath = argv.find(arg => arg.startsWith('--data='))?.split('=')[1];

if (command === '--help') {
  console.log(`
Usage:
  add <title> --data <path>
  list --data <path>
  done <id> --data <path>
  remove <id> --data <path>
  --help
`);
} else if (command && dataPath) {
  const taskStore = new TaskStore(dataPath);

  switch (command) {
    case 'add':
      const title = argv.find(arg => !arg.startsWith('--')) || '';
      console.log(taskStore.add(title));
      break;
    case 'list':
      console.log(JSON.stringify(taskStore.list(), null, 2));
      break;
    case 'done':
      const id = argv.find(arg => !arg.startsWith('--')) || '';
      console.log(taskStore.done(id));
      break;
    case 'remove':
      const removeId = argv.find(arg => !arg.startsWith('--')) || '';
      console.log(taskStore.remove(removeId));
      break;
    default:
      console.error('Unknown command');
  }
} else {
  console.error('Invalid usage. Use --help for more information.');
}