// Import necessary modules
const server = require('./server');
const PORT = process.env.PORT || 3000;

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});