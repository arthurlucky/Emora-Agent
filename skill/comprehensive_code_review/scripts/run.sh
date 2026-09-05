#!/bin/bash
# Comprehensive Code Review Automation Script
# Usage: ./code_review.sh /path/to/project

PROJECT_PATH="${1:-.}"
REPORT_FILE="code_review_report.md"

echo "# 📊 Code Review Report" > "$REPORT_FILE"
echo "Generated: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "## Project Structure"
echo '' >> "$REPORT_FILE"
find "$PROJECT_PATH" -type f \( -name '*.js' -o -name '*.json' -o -name '*.md' \) | head -20 >> "$REPORT_FILE"
echo '' >> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "## Dependency Analysis" >> "$REPORT_FILE"
if [ -f "$PROJECT_PATH/package.json" ]; then
  echo '' >> "$REPORT_FILE"
  grep -A 20 '"dependencies"' "$PROJECT_PATH/package.json" >> "$REPORT_FILE"
  echo '' >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
echo "## Security Patterns Check" >> "$REPORT_FILE"
echo 'Searching for potential issues...' >> "$REPORT_FILE"
grep -r 'eval\|exec\|TODO\|FIXME\|XXX' "$PROJECT_PATH" --include='*.js' 2>/dev/null | head -10 >> "$REPORT_FILE" || echo "No issues found" >> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "## Documentation Status" >> "$REPORT_FILE"
if [ -f "$PROJECT_PATH/README.md" ]; then
  echo '✅ README.md exists' >> "$REPORT_FILE"
else
  echo '❌ README.md missing' >> "$REPORT_FILE"
fi

if [ -f "$PROJECT_PATH/.gitignore" ]; then
  echo '✅ .gitignore exists' >> "$REPORT_FILE"
else
  echo '❌ .gitignore missing' >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
echo "Report saved to $REPORT_FILE"
cat "$REPORT_FILE"