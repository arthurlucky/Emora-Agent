#!/usr/bin/env python3
# Interactive star graphics with menu and animations

import math
import sys
import time

class StarGraphics:
    def __init__(self):
        self.patterns = {
            '1': ('Pyramid', self.star_pyramid),
            '2': ('Diamond', self.star_diamond),
            '3': ('Rectangle', self.star_rectangle),
            '4': ('Wave', self.star_wave),
            '5': ('Heart', self.star_heart),
            '6': ('Spiral', self.star_spiral),
            '7': ('Galaxy', self.star_galaxy),
            '8': ('Checkerboard', self.star_checkerboard),
            '9': ('Hourglass', self.star_hourglass),
            '10': ('All Patterns', self.show_all),
            '11': ('Animated Wave', self.animated_wave),
        }
    
    def clear_screen(self):
        """Clear terminal screen"""
        print("\033[2J\033[H", end="")
    
    def show_menu(self):
        """Display main menu"""
        print("=" * 60)
        print("  🌟 STAR GRAPHICS GENERATOR - INTERACTIVE MENU 🌟")
        print("=" * 60)
        print()
        for key, (name, _) in self.patterns.items():
            print(f"  {key:2}. {name}")
        print()
        print("  0. Exit")
        print()
        print("=" * 60)
    
    def star_pyramid(self, height=6):
        """Print a pyramid of stars"""
        print("\n⭐ STAR PYRAMID ⭐\n")
        for i in range(1, height + 1):
            print(" " * (height - i) + "★" * i)
    
    def star_diamond(self, size=5):
        """Print a diamond shape with stars"""
        print("\n⭐ STAR DIAMOND ⭐\n")
        for i in range(size):
            print(" " * (size - i - 1) + "★" * (2 * i + 1))
        for i in range(size - 2, -1, -1):
            print(" " * (size - i - 1) + "★" * (2 * i + 1))
    
    def star_rectangle(self, width=20, height=6):
        """Print a rectangle with star border"""
        print("\n⭐ STAR RECTANGLE ⭐\n")
        print("★" * width)
        for _ in range(height - 2):
            print("★" + " " * (width - 2) + "★")
        print("★" * width)
    
    def star_wave(self):
        """Print a wave pattern with stars"""
        print("\n⭐ STAR WAVE ⭐\n")
        for i in range(8):
            spaces = int(5 + 3 * math.sin(i * 0.8))
            print(" " * spaces + "★")
    
    def star_heart(self):
        """Print a heart shape with stars"""
        print("\n⭐ STAR HEART ⭐\n")
        heart = [
            "  ★★★       ★★★  ",
            " ★★★★★     ★★★★★ ",
            "★★★★★★★   ★★★★★★★",
            "★★★★★★★★ ★★★★★★★★",
            "★★★★★★★★★★★★★★★★★",
            "★★★★★★★★★★★★★★★★★",
            " ★★★★★★★★★★★★★★★ ",
            "  ★★★★★★★★★★★★★  ",
            "   ★★★★★★★★★★★   ",
            "    ★★★★★★★★★    ",
            "     ★★★★★★★     ",
            "      ★★★★★      ",
            "       ★★★       ",
            "        ★        "
        ]
        for line in heart:
            print(line)
    
    def star_spiral(self):
        """Print a spiral pattern with stars"""
        print("\n⭐ STAR SPIRAL ⭐\n")
        size = 9
        spiral = [[" " for _ in range(size)] for _ in range(size)]
        
        x, y = 0, 0
        dx, dy = 1, 0
        
        for i in range(size * size):
            spiral[y][x] = "★"
            nx, ny = x + dx, y + dy
            
            if not (0 <= nx < size and 0 <= ny < size and spiral[ny][nx] == " "):
                dx, dy = -dy, dx
                nx, ny = x + dx, y + dy
            
            x, y = nx, ny
        
        for row in spiral:
            print(" " + "".join(row))
    
    def star_galaxy(self):
        """Print a galaxy/constellation pattern"""
        print("\n⭐ STAR GALAXY ⭐\n")
        galaxy = [
            "           ★           ",
            "       ★       ★       ",
            "     ★           ★     ",
            "   ★               ★   ",
            " ★       ★ ★ ★       ★ ",
            "★     ★           ★     ★",
            " ★       ★ ★ ★       ★ ",
            "   ★               ★   ",
            "     ★           ★     ",
            "       ★       ★       ",
            "           ★           ",
        ]
        for line in galaxy:
            print(line)
    
    def star_checkerboard(self, size=8):
        """Print a checkerboard pattern with stars"""
        print(f"\n⭐ STAR CHECKERBOARD ({size}x{size}) ⭐\n")
        for i in range(size):
            row = ""
            for j in range(size):
                if (i + j) % 2 == 0:
                    row += "★ "
                else:
                    row += "  "
            print(row)
    
    def star_hourglass(self, size=7):
        """Print an hourglass shape with stars"""
        print("\n⭐ STAR HOURGLASS ⭐\n")
        for i in range(size):
            print(" " * i + "★" * (2 * (size - i) - 1))
        for i in range(1, size):
            print(" " * (size - i) + "★" * (2 * i - 1))
    
    def animated_wave(self):
        """Print animated wave pattern"""
        print("\n⭐ ANIMATED WAVE ⭐\n")
        for frame in range(16):
            sys.stdout.write(f"\rFrame {frame + 1}/16 ")
            sys.stdout.flush()
            for i in range(8):
                offset = (i + frame) % 16
                spaces = int(5 + 4 * math.sin((i + frame) * 0.4))
                if offset < 8:
                    print(" " * spaces + "★", end="\n" if i < 7 else "")
            time.sleep(0.2)
        print("\n")
    
    def show_all(self):
        """Display all patterns"""
        print("\n" + "=" * 60)
        print("  🌟 ALL STAR PATTERNS 🌟")
        print("=" * 60)
        self.star_pyramid(5)
        self.star_diamond(4)
        self.star_rectangle(18, 5)
        self.star_wave()
        self.star_heart()
        self.star_spiral()
        self.star_galaxy()
        self.star_checkerboard(6)
        self.star_hourglass(5)
    
    def run(self):
        """Run interactive menu"""
        while True:
            self.show_menu()
            choice = input("  Select pattern (0-11): ").strip()
            
            if choice == '0':
                print("\n  👋 Thanks for using Star Graphics Generator!")
                print("  ✨ Goodbye! ✨\n")
                break
            
            if choice in self.patterns:
                print("\n")
                _, func = self.patterns[choice]
                try:
                    func()
                except Exception as e:
                    print(f"  ❌ Error: {e}")
                
                input("\n  Press Enter to continue...")
            else:
                print("  ❌ Invalid choice! Please try again.")
                input("  Press Enter to continue...")

def main():
    """Main entry point"""
    try:
        app = StarGraphics()
        app.run()
    except KeyboardInterrupt:
        print("\n\n  👋 Program interrupted. Goodbye!\n")
        sys.exit(0)

if __name__ == "__main__":
    main()
