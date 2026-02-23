"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("./store");
function help() {
    console.log(`Usage:\n  list --data <path>\n  add <title> --data <path>\n  done <id> --data <path>\n  remove <id> --data <path>`);
}
async function main(args) {
    const command = args[0];
    const dataPathIndex = args.indexOf("--data");
    if (command === "--help") {
        help();
        process.exit(0);
    }
    if (dataPathIndex === -1 || !args[dataPathIndex + 1]) {
        console.error("Missing --data <path>");
        process.exit(1);
    }
    const dataPath = args[dataPathIndex + 1];
    const store = new store_1.TaskStore(dataPath);
    switch (command) {
        case "list":
            const tasks = await store.list();
            console.log(JSON.stringify({ ok: true, tasks }));
            break;
        case "add":
            if (!args[1] || args[1].startsWith("--")) {
                console.error("Missing title");
                process.exit(1);
            }
            const task = await store.add(args[1]);
            console.log(JSON.stringify({ ok: true, task }));
            break;
        case "done":
            if (!args[1] || args[1].startsWith("--")) {
                console.error("Missing id");
                process.exit(1);
            }
            const doneTask = await store.done(args[1]);
            console.log(JSON.stringify({ ok: true, task: doneTask }));
            break;
        case "remove":
            if (!args[1] || args[1].startsWith("--")) {
                console.error("Missing id");
                process.exit(1);
            }
            const removedTask = await store.remove(args[1]);
            console.log(JSON.stringify({ ok: true, task: removedTask }));
            break;
        default:
            console.error(`Unknown command: ${command}`);
            process.exit(1);
    }
}
main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
});
