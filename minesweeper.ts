type TileNum = number
type Tile = "mine" | "empty" | TileNum
type State = "hidden" | "flagged" | "displayed"

class Square {
    state: State;
    tile: Tile;
    hidden: Set<Square>;
    flagged: Set<Square>;
    neighs: Set<Square>;
    idx: TileIdx;

    constructor(tileIdx: TileIdx, tile: Tile) {
        this.state = "hidden";
        this.tile = tile;
        this.hidden = new Set();
        this.flagged = new Set();
        this.neighs = new Set();
        this.idx = tileIdx;
    }

    reveal() {
        this.state = "displayed";
        for (let neigh of this.neighs) {
            neigh.remove_hidden(this);
        }
    }

    flag() {
        this.state = "flagged";
        for (let neigh of this.neighs) {
            neigh.add_flag(this);
        }
    }

    unflag() {
        this.state = "hidden";
        for (let neigh of this.neighs) {
            neigh.remove_flag(this);
        }
    }

    add_hiddens(hiddens: Square[]) {
        for (let hid of hiddens) {
            this.hidden.add(hid);
            this.neighs.add(hid);
        }
    }

    remove_hidden(hidden: Square) {
        this.hidden.delete(hidden);
    }

    add_flag(flag_sq: Square) {
        this.hidden.delete(flag_sq);
        this.flagged.add(flag_sq);
    }

    remove_flag(flag_sq: Square) {
        this.flagged.delete(flag_sq);
        this.hidden.add(flag_sq);
    }
}

type TileIdx = [number, number]
type TileRet = [TileIdx, Tile]
type SpaceReveal = "flag" | "unflag" | "reveal"
type SpaceRet = [SpaceReveal, TileRet[]]
var defaultSpaceRet: SpaceRet = ["reveal", []]

class Board {
    width: bigint;
    height: bigint;
    totMines: bigint;
    squares: Array<Array<Square>>;
    over: boolean;

    NEIGHS: TileIdx[] = [
        [1, 1], [1, 0], [1, -1],
        [0, 1], [0, -1],
        [-1, 1], [-1, 0], [-1, -1]
    ];

    constructor(
        width: bigint,
        height: bigint,
        tileIdx: TileIdx,
        mines: bigint | number = 99n
    ) {
        this.width = width;
        this.height = height;
        if (typeof mines === "bigint") {
            let minesCapped = Math.max(0,
                Math.min(Number(height * width), Number(mines)));
            this.totMines = BigInt(minesCapped);
        }
        else {
            let pct = Math.max(0, Math.min(1, mines));
            this.totMines = BigInt(
                Math.round(Number(width) * Number(height) * pct));
        }

        this.squares = this.initSquares(tileIdx);
        this.over = false;
    }

    getSquare(tileIdx: TileIdx): Square {
        let x = tileIdx[0], y = tileIdx[1];
        return this.squares[y][x];
    }

    convert1d2d(idx: number): TileIdx {
        let x = idx % Number(this.width);
        let y = Math.floor(idx / Number(this.width));
        return [x, y];
    }

    convert2d1d(tileIdx: TileIdx): number {
        let x = tileIdx[0], y = tileIdx[1];
        return y * Number(this.width) + x;
    }

    getNeighbors(tileIdx: TileIdx): TileIdx[] {
        let x = tileIdx[0], y = tileIdx[1];
        let ret = this.NEIGHS.map((pair) => {
            let neigh: TileIdx = [pair[0] + x, pair[1] + y];
            return neigh
        }).filter(pair => pair[0] >= 0 && pair[0] < this.width
            && pair[1] >= 0 && pair[1] < this.height);

        return ret;
    }

    countAdjacent(tileIdx: TileIdx, mineSquares: Set<number>)
        : Tile {
        let neighs = this.getNeighbors(tileIdx)
            .filter(x => mineSquares.has(this.convert2d1d(x)));
        if (neighs.length == 0) {
            return "empty";
        }
        else {
            return neighs.length;
        }
    }

    correctFlagged(tileIdx: TileIdx): boolean {
        var square = this.getSquare(tileIdx);
        if (square.tile === "mine" ||
            square.tile === "empty") {
            return false;
        }
        else {
            return square.flagged.size === square.tile;
        }
    }

    initSquares(tileIdx: TileIdx): Array<Array<Square>> {
        let nums = [...Array(Number(this.width * this.height)).keys()];
        function shuffle(array: any[]) {
            var currentIndex = array.length, temporaryValue, randomIndex;
          
            // While there remain elements to shuffle...
            while (0 !== currentIndex) {
          
              // Pick a remaining element...
              randomIndex = Math.floor(Math.random() * currentIndex);
              currentIndex -= 1;
          
              // And swap it with the current element.
              temporaryValue = array[currentIndex];
              array[currentIndex] = array[randomIndex];
              array[randomIndex] = temporaryValue;
            }
          
            return array;
        }
        let randomized: number[] = shuffle(nums);
        let neighbor1d = this.getNeighbors(tileIdx)
            .map(idx => this.convert2d1d(idx));
        let safeSquares = new Set(neighbor1d);
        safeSquares.add(this.convert2d1d(tileIdx));
        let potentialMines = randomized.filter(x => !safeSquares.has(x));

        var mineSquares = potentialMines.slice(0, Number(this.totMines))
            .map(idx => this.convert1d2d(idx));

        var squares: Square[][] = new Array();
        for (let i=0; i < this.height; i++) {
            let empty: Square[] = new Array(Number(this.width));
            squares.push(empty);
        }

        for (let tileIdx of mineSquares) {
            let x = tileIdx[0];
            let y = tileIdx[1];

            squares[y][x] = new Square(tileIdx, "mine");
        }

        var mineSet = new Set(mineSquares.map(pair => this.convert2d1d(pair)));

        for (let j = 0; j < this.height; j++) {
            for (let i = 0; i < this.width; i++) {
                let idx: TileIdx = [i, j];
                if (mineSet.has(this.convert2d1d(idx))) {
                    continue;
                }
                let numMines = this.countAdjacent(idx, mineSet);
                squares[j][i] = new Square(idx, numMines);
            }
        }

        for (let j = 0; j < this.height; j++) {
            for (let i = 0; i < this.width; i++) {
                let idx: TileIdx = [i, j]
                let neighs = this.getNeighbors(idx)
                    .map(pair => squares[pair[1]][pair[0]]);
                squares[j][i].add_hiddens(neighs);
            }
        }

        return squares;
    }

    revealSquare(square: Square): TileRet[] {
        if (this.over) {
            return [];
        }
        square.reveal();
        var ret: TileRet[] = [[square.idx, square.tile]]
        if (square.tile === "empty") {
            for (let neigh of square.hidden) {
                let neighRet = this.revealSquare(neigh);
                ret = ret.concat(neighRet);
            }
            return ret;
        }
        else if (square.tile === "mine") {
            this.over = true;
            return ret;
        }
        return ret;
    }

    revealIdx(tileIdx: TileIdx): TileRet[] {
        let x = tileIdx[0], y = tileIdx[1]
        return this.revealSquare(this.squares[y][x]);
    }

    flagSquare(tileIdx: TileIdx): TileIdx[] {
        if (this.over) {
            return [];
        }
        let x = tileIdx[0], y = tileIdx[1];
        if (this.squares[y][x].state === "hidden") {
            this.squares[y][x].flag();
            return [tileIdx];
        }
        return [];
    }

    unflagSquare(tileIdx: TileIdx): TileIdx[] {
        if (this.over) {
            return [];
        }
        let x = tileIdx[0], y = tileIdx[1];
        if (this.squares[y][x].state === "flagged") {
            this.squares[y][x].unflag();
            return [tileIdx];
        }
        return [];
    }

    revealAround(tileIdx: TileIdx): SpaceRet {
        if (this.over) {
            return defaultSpaceRet;
        }
        var square = this.getSquare(tileIdx);
        if (square.state === "hidden") {
            return ["flag", []];
        }
        else if (square.state === "flagged") {
            return ["unflag", []];
        }
        else if (this.correctFlagged(tileIdx)) {
            let ret: TileRet[] = new Array();
            for (let neigh of square.hidden) {
                ret = ret.concat(this.revealSquare(neigh));
            }
            return ["reveal", ret];
        }
        else {
            return defaultSpaceRet;
        }
    }
}

/* WebPage Interactions */
type Id = string
type Game = Board | null
type Hover = TileIdx | null

class WebGame {
    doc: Document;
    width: bigint;
    height: bigint;
    game: Game;
    hover: Hover;
    container: Element;

    constructor(
        doc: Document,
        width = 20n,
        height = 20n,
    ) {
        this.doc = doc;
        this.width = width;
        this.height = height;
        this.game = null;
        this.hover = null;
        this.container = this.doc.getElementById("game")!;
        this.initGameSpace();
    }

    initGameSpace() {
        this.container.addEventListener('contextmenu', e => {
            e.preventDefault();
            return false;
        }, false);
        this.container.addEventListener('mouseleave', e => {
            this.hover = null;
        });
        this.doc.addEventListener('keydown', e => {
            if (e.code === 'Space') {
                if (this.hover !== null) {
                    console.log("Space");
                    this.spaceClick(this.hover);
                }
            }
        })
    }

    spaceClick(tileIdx: TileIdx) {
        if (this.game !== null) {
            let retPair = this.game.revealAround(tileIdx);
            let retType = retPair[0], retArr = retPair[1];
            if (retType === "flag") {
                this.flag(tileIdx);
            }
            else if (retType === "unflag") {
                this.unflag(tileIdx);
            }
            else {
                for (let pair of retArr) {
                    let idx = pair[0], num = pair[1];
                    this.revealPair(idx, num);
                }
            }
        }
    }

    emptyClick(tileIdx: TileIdx) {
        if (this.game === null) {
            this.game = new Board(this.width, this.height, tileIdx);
        }
        let retArr = this.game.revealIdx(tileIdx);
        for (let pair of retArr) {
            let idx = pair[0], num = pair[1];
            this.revealPair(idx, num);
        }
    }

    revealPair(tileIdx: TileIdx, num: Tile) {
        let id = this.genId(tileIdx);
        let tile = this.doc.getElementById(id)!;
        tile.onclick = null;
        tile.oncontextmenu = null;
        tile.classList.remove("hidden");
        tile.classList.add("revealed");
        if (num === "mine") {
            tile.classList.add("mine");
        }
        else if (num === "empty") {
            return;
        }
        else {
            tile.classList.add("num_" + num.toString());
        }
    }

    flag(tileIdx: TileIdx) {
        if (this.game === null) {
            return;
        }
        else {
            let ret = this.game.flagSquare(tileIdx);
            for (let pair of ret) {
                let id = this.genId(pair);
                let tile = this.doc.getElementById(id)!;
                tile.onclick = null;
                tile.oncontextmenu = () => {
                    this.unflag(tileIdx);
                };
                tile.classList.add("flagged");
            }
        }
    }

    unflag(tileIdx: TileIdx) {
        if (this.game === null) {
            return;
        }
        else {
            let ret = this.game.unflagSquare(tileIdx);
            for (let pair of ret) {
                let id = this.genId(pair);
                let tile = this.doc.getElementById(id)!;
                tile.onclick = () => {
                    this.emptyClick(tileIdx)
                };
                tile.oncontextmenu = () => {
                    this.flag(tileIdx)
                };
                tile.classList.remove("flagged");
            }
        }
    }

    genId(tileIdx: TileIdx): Id {
        let x = tileIdx[0], y = tileIdx[1];
        return x.toString() + "_" + y.toString();
    }

    genTile(tileIdx: TileIdx) {
        let tile = this.doc.createElement('div');
        tile.classList.add("tile");
        tile.classList.add("hidden")
        tile.id = this.genId(tileIdx);
        tile.onclick = () => {
            this.emptyClick(tileIdx);
        };
        tile.oncontextmenu = () => {
            this.flag(tileIdx);
        };
        tile.addEventListener('mouseover', e => {
            this.hover = tileIdx;
        });
        return tile;
    }
    
    genRow(j: number) {
        let row = this.doc.createElement('div');
        row.classList.add("row");
        for (let i = 0; i < this.width; i++) {
            let tileIdx: TileIdx = [i, j];
            let tile = this.genTile(tileIdx);
            row.appendChild(tile);
        }
        return row;
    }

    genBoard() {
        var board = this.doc.getElementById("game")!;
        for (let j = 0; j < this.height; j++) {
            let row = this.genRow(j);
            board.appendChild(row);
        }
    }
}
