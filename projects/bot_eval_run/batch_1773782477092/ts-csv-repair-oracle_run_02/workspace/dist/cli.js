const fs = require("node:fs");
const { CsvParser, CsvFilter } = require("./csv");
const args = process.argv.slice(2);
const inputIdx = args.indexOf("--input");
if (args[0] === "parse") {
    if (inputIdx !== -1 && inputIdx + 1 < args.length) {
        const fileContent = fs.readFileSync(args[inputIdx + 1], "utf8");
        const parser = new CsvParser();
        const rows = parser.parse(fileContent);
        console.log(JSON.stringify(rows));
    }
    else {
        console.error("Usage: parse --input <file>");
        process.exit(1);
    }
}
else if (args[0] === "stats") {
    if (inputIdx !== -1 && inputIdx + 1 < args.length) {
        const fileContent = fs.readFileSync(args[inputIdx + 1], "utf8");
        const parser = new CsvParser();
        const rows = parser.parse(fileContent);
        const filter = new CsvFilter(rows);
        console.log(`Rows: ${filter.count()}`);
        if (rows.length > 0) {
            console.log(`Columns: ${Object.keys(rows[0]).join(", ")}`);
        }
        else {
            console.log("Columns:");
        }
    }
    else {
        console.error("Usage: stats --input <file>");
        process.exit(1);
    }
}
else if (args[0] === "--help") {
    console.log(`Commands:
parse --input <file>
stats --input <file>
--help`);
}
else {
    console.error("Unknown command. Use --help for available commands.");
    process.exit(1);
}
