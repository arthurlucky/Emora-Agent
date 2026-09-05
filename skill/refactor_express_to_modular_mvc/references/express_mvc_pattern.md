# Express MVC Pattern Reference

## Folder Conventions
- `controllers/` - Handler untuk business logic
- `routes/` - Route definitions
- `middleware/` - Shared middleware (auth, validation, error handling)
- `models/` - Database models (jika menggunakan ORM)
- `utils/` - Helper functions
- `config/` - Configuration files

## Controller Template
javascript
// controllers/resourceController.js
const model = require('../models/resource');

exports.getAll = async (req, res, next) => {
  try {
    const data = await model.findAll();
    res.json(data);
  } catch (err) {
    next(err); // Pass ke error handler
  }
};

exports.getById = async (req, res, next) => {
  try {
    const data = await model.findById(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
};


## Route Template
javascript
// routes/resource.js
const express = require('express');
const controller = require('../controllers/resourceController');
const router = express.Router();

router.get('/', controller.getAll);
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.delete);

module.exports = router;

