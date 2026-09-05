#!/bin/bash
# refactor-express-to-mvc.sh
# Automasi refactor Express.js ke struktur MVC

set -e

PROJECT_DIR="${1:-.}"
echo "🔄 Refactoring Express project: $PROJECT_DIR"

# 1. Create folder structure
echo "📁 Creating folders..."
mkdir -p "$PROJECT_DIR/controllers"
mkdir -p "$PROJECT_DIR/routes"
mkdir -p "$PROJECT_DIR/middleware"

# 2. Backup original index.js
echo "💾 Backing up original index.js..."
cp "$PROJECT_DIR/index.js" "$PROJECT_DIR/index.js.bak"

# 3. Create default error handler middleware
echo "⚙️  Creating error handler middleware..."
cat > "$PROJECT_DIR/middleware/errorHandler.js" << 'EOF'
module.exports = (err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message });
};
EOF

echo "✅ Refactoring complete!"
echo "📝 Next steps:"
echo "  1. Move business logic dari index.js ke controllers/"
echo "  2. Buat routes files di routes/"
echo "  3. Update index.js untuk mount routes"
echo "  4. Test dengan: npm start"
