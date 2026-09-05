---
name: Refactor Express.js to Modular MVC Structure
description: Transform monolithic Express.js project into scalable modular architecture dengan separation of concerns (Controllers, Routes, Middleware)
categories: devops, backend, refactoring
---

# Panduan: Refactor Express.js ke Struktur Modular MVC

## Overview
Skill ini mengkonversi Express.js project yang terpusat (single index.js) menjadi struktur modular dengan:
- **Controllers**: Business logic terpisah
- **Routes**: Route definitions
- **Middleware**: Shared middleware (error handling, validation, dll)

## Proses Langkah-demi-Langkah

### 1. Analisis Existing Project
bash
# Baca struktur dan dependencies existing
cat package.json
cat index.js

Identifikasi:
- Framework & dependencies (Express version, dll)
- Existing endpoints/routes
- Business logic yang perlu dipisah

### 2. Desain Struktur Target
Target structure:

project/
├── index.js              (Entry point, server setup)
├── package.json
├── controllers/          (Business logic)
│   ├── apiController.js
│   └── ...
├── routes/               (Route definitions)
│   ├── api.js
│   └── ...
└── middleware/           (Shared middleware)
    └── errorHandler.js


### 3. Buat Folder Structure
bash
mkdir -p controllers routes middleware


### 4. Ekstrak Business Logic ke Controllers
Setiap endpoint/resource mendapat controller file:
javascript
// controllers/exampleController.js
exports.getData = (req, res) => {
  res.json({ message: "data" });
};

exports.createData = (req, res) => {
  res.json({ status: "created" });
};


### 5. Buat Route Files
Setiap resource mendapat route file:
javascript
// routes/example.js
const express = require('express');
const controller = require('../controllers/exampleController');
const router = express.Router();

router.get('/', controller.getData);
router.post('/', controller.createData);

module.exports = router;


### 6. Implementasi Error Handling Middleware
javascript
// middleware/errorHandler.js
module.exports = (err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message });
};


### 7. Update Entry Point (index.js)
javascript
// index.js - Minimal, clean
const express = require('express');
const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/api/example', require('./routes/example'));

// Error handler
app.use(require('./middleware/errorHandler'));

app.listen(3000, () => console.log('Server running'));


## Best Practices
✅ Satu endpoint/resource = satu file route + satu file controller  
✅ Middleware shared di folder middleware/  
✅ Entry point (index.js) hanya setup, bukan logic  
✅ Gunakan router.get/post/put/delete untuk HTTP methods  
✅ Error handling centralized di middleware  

## Keuntungan
- **Scalable**: Mudah tambah API baru tanpa modify index.js
- **Maintainable**: Logic terpisah, mudah debug
- **Testable**: Controller & middleware bisa ditest terpisah
- **Team-friendly**: Developer lain mudah follow struktur

## Tools Required
- Node.js + npm
- Express.js framework
