#!/usr/bin/env python3
# Demo script - Auto-play star patterns

import math
import time
import sys

class StarDemo:
    def __init__(self):
        self.delay = 0.5  # Delay between patterns (seconds)
    
    def separator(self, title=""):
        """Print a styled separator"""
        if title:
            print(f"\n{'=' * 60}")
            print(f"  {title}")
            print(f"{'=' * 60}\n")
        else:
            print(f"\n{'-' * 60}\n")
    
    def demo_pyramid(self):
        """Demo: Pyramid pattern"""
        self.separator("⭐ PYRAMID DEMO")
        sizes = [3, 4, 5, 6]
        for size in sizes:
            for i in range(1, size + 1):
                print(" " * (size - i) + "★" * i)
            time.sleep(self.delay)
            print()
    
    def demo_growing_diamond(self):
        """Demo: Growing diamond pattern"""
        self.separator("⭐ GROWING DIAMOND DEMO")
        sizes = [2, 3, 4, 5]
        for size in sizes:
            for i in range(size):
                print(" " * (size - i - 1) + "★" * (2 * i + 1))
            for i in range(size - 2, -1, -1):
                print(" " * (size - i - 1) + "★" * (2 * i + 1))
            time.sleep(self.delay)
            self.separator()
    
    def demo_expanding_rectangle(self):
        """Demo: Expanding rectangle pattern"""
        self.separator("⭐ EXPANDING RECTANGLE DEMO")
        widths = [5, 10, 15, 20]
        height = 4
        for width in widths:
            print("★" * width)
            for _ in range(height - 2):
                print("★" + " " * (width - 2) + "★")
            print("★" * width)
            time.sleep(self.delay)
            print()
    
    def demo_rotating_wave(self):
        """Demo: Rotating wave animation"""
        self.separator("⭐ ROTATING WAVE DEMO")
        for frame in range(12):
            for i in range(6):
                spaces = int(4 + 3 * math.sin((i + frame * 0.5) * 0.6))
                print(" " * spaces + "★")
            time.sleep(0.3)
            print()
    
    def demo_cascading_stars(self):
        """Demo: Cascading stars effect"""
        self.separator("⭐ CASCADING STARS DEMO")
        for level in range(1, 8):
            for i in range(level):
                print(" " * i + "★")
            time.sleep(0.4)
    
    def demo_spiral_expansion(self):
        """Demo: Spiral expansion"""
        self.separator("⭐ SPIRAL EXPANSION DEMO")
        for radius in range(1, 6):
            lines = []
            for angle in range(0, 360, 45):
                rad = math.radians(angle)
                x = int(radius * math.cos(rad))
                y = int(radius * math.sin(rad))
                lines.append((y, x))
            
            min_y = min(l[0] for l in lines)
            max_y = max(l[0] for l in lines)
            min_x = min(l[1] for l in lines)
            max_x = max(l[1] for l in lines)
            
            height = max_y - min_y + 1
            width = max_x - min_x + 1
            
            grid = [[" " for _ in range(width)] for _ in range(height)]
            grid[abs(min_y)][abs(min_x)] = "⊙"
            
            for y, x in lines:
                try:
                    grid[y - min_y][x - min_x] = "★"
                except:
                    pass
            
            for row in grid:
                print("".join(row))
            print()
            time.sleep(self.delay)
    
    def demo_pulsing_heart(self):
        """Demo: Pulsing heart effect"""
        self.separator("⭐ PULSING HEART DEMO")
        heart_full = [
            "  ★★★       ★★★  ",
            " ★★★★★     ★★★★★ ",
            "★★★★★★★   ★★★★★★★",
            "★★★★★★★★ ★★★★★★★★",
            "★★★★★★★★★★★★★★★★★",
        ]
        
        heart_outline = [
            "  ★★★       ★★★  ",
            " ★     ★   ★     ★ ",
            "★       ★ ★       ★",
            "★       ★ ★       ★",
            "★       ★ ★       ★",
        ]
        
        for pulse in range(3):
            for heart in [heart_full, heart_outline]:
                for line in heart[:5]:
                    print(line)
                time.sleep(0.3)
                self.separator()
    
    def demo_matrix_rain(self):
        """Demo: Matrix-style rain"""
        self.separator("⭐ MATRIX RAIN DEMO")
        cols = 20
        rows = 8
        
        for frame in range(rows + 5):
            line = ""
            for col in range(cols):
                if frame - col >= 0 and frame - col < rows:
                    line += "★ "
                else:
                    line += "  "
            print(line)
            time.sleep(0.2)
    
    def demo_summary(self):
        """Display demo summary"""
        self.separator("🌟 DEMO COMPLETE 🌟")
        print("""
  Patterns shown:
  ✓ Pyramid growth
  ✓ Growing diamond
  ✓ Expanding rectangle
  ✓ Rotating wave
  ✓ Cascading stars
  ✓ Spiral expansion
  ✓ Pulsing heart
  ✓ Matrix rain
  
  Total execution time: ~15 seconds
  
  💡 Tip: Run hello.py interactively for more options!
        """)
    
    def run_all(self):
        """Run all demos in sequence"""
        print("\n" + "=" * 60)
        print("  🌟 STAR GRAPHICS DEMO - AUTO PLAY 🌟")
        print("=" * 60)
        time.sleep(1)
        
        try:
            self.demo_pyramid()
            time.sleep(0.5)
            
            self.demo_growing_diamond()
            time.sleep(0.5)
            
            self.demo_expanding_rectangle()
            time.sleep(0.5)
            
            self.demo_rotating_wave()
            time.sleep(0.5)
            
            self.demo_cascading_stars()
            time.sleep(0.5)
            
            self.demo_spiral_expansion()
            time.sleep(0.5)
            
            self.demo_pulsing_heart()
            time.sleep(0.5)
            
            self.demo_matrix_rain()
            time.sleep(0.5)
            
            self.demo_summary()
            
        except KeyboardInterrupt:
            print("\n\n  ⚠️  Demo interrupted by user.")
            print("  👋 Goodbye!\n")

def main():
    """Main entry point"""
    demo = StarDemo()
    demo.run_all()

if __name__ == "__main__":
    main()
