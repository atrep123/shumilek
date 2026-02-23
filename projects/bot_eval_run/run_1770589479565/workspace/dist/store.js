"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryTaskStore = void 0;
optional;
doneAt ?  : string;
class InMemoryTaskStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.tasks = [];
    }
}
exports.InMemoryTaskStore = InMemoryTaskStore;
// ... (remaining part of the file remains unchanged)
