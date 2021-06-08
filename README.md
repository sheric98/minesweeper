# minesweeper
Minesweeper for a browser written in Typescript.

# Build

To build, after cloning the repository run:  
`npm install`

Then to compile the typescript file, run:  
`npm run tsc`

This will generate a "minesweeper.js" file.

# Run

After building, simply open the "minesweeper.html" file in a browser to play!

# Instructions

Left-clicking on a hidden tile reveals it.  
  
Right-clicking or pressing space while hovering over a hidden tile flags it.  
  
Pressing space while hovering over a revealed tile will reveal all neighboring tiles assuming that the number of flagged neighbor tiles matches the number of neighboring mines as indicated by the number on the revealed tile.  

To start a game, simply left-click on any of the hidden tiles.
