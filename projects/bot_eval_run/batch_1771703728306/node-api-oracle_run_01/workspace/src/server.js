// src/server.js
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

let todos = [];

if (fs.existsSync(path.join(__dirname, 'todos.json'))) {
  todos = JSON.parse(fs.readFileSync(path.join(__dirname, 'todos.json'), 'utf8')) || [];
}

app.get('/health', (req, res) => {
  res.json({ status: 'API is healthy' });
});

app.get('/todos', (req, res) => {
  res.json({ ok: true, todos });
});

app.post('/todos', (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ ok: false, error: 'Title is required' });
  }

  const newTodo = {
    id: crypto.randomBytes(16).toString('hex'),
    title,
    done: false,
    createdAt: new Date().toISOString(),
    doneAt: null
  };

  todos.push(newTodo);
  fs.writeFileSync(path.join(__dirname, 'todos.json'), JSON.stringify(todos, null, 2));
  res.status(201).json({ ok: true, todo: newTodo });
});

app.get('/todos/:id', (req, res) => {
  const { id } = req.params;
  const todo = todos.find(t => t.id === id);
  if (!todo) {
    return res.status(404).json({ ok: false, error: 'TODO item not found' });
  }
  res.json({ ok: true, todo });
});

app.patch('/todos/:id', (req, res) => {
  const { id } = req.params;
  const { done } = req.body;
  const todoIndex = todos.findIndex(t => t.id === id);
  if (todoIndex === -1) {
    return res.status(404).json({ ok: false, error: 'TODO item not found' });
  }

  const todo = todos[todoIndex];
  if (done !== undefined) {
    todo.done = done;
    if (todo.done) {
      todo.doneAt = new Date().toISOString();
    } else {
      todo.doneAt = null;
    }
  }

  fs.writeFileSync(path.join(__dirname, 'todos.json'), JSON.stringify(todos, null, 2));
  res.json({ ok: true, todo });
});

app.delete('/todos/:id', (req, res) => {
  const { id } = req.params;
  const todoIndex = todos.findIndex(t => t.id === id);
  if (todoIndex === -1) {
    return res.status(404).json({ ok: false, error: 'TODO item not found' });
  }

  todos.splice(todoIndex, 1);
  fs.writeFileSync(path.join(__dirname, 'todos.json'), JSON.stringify(todos, null, 2));
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});