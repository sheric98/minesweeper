type TileNum = number
type Tile = "mine" | "empty" | TileNum
type State = "hidden" | "flagged" | "displayed"
type MineNum = bigint | number
type GameState = -1 | 0 | 1

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
    mines: Set<Square>;
    unclearedSquares: bigint;
    gameState: GameState;

    NEIGHS: TileIdx[] = [
        [1, 1], [1, 0], [1, -1],
        [0, 1], [0, -1],
        [-1, 1], [-1, 0], [-1, -1]
    ];

    static getNumMines(width: bigint, height: bigint, mines: MineNum): bigint {
        if (typeof mines === "bigint") {
            let minesCapped = Math.max(0,
                Math.min(Number(height * width), Number(mines)));
            return BigInt(minesCapped);
        }
        else {
            let pct = Math.max(0, Math.min(1, mines));
            return BigInt(
                Math.round(Number(width) * Number(height) * pct));
        }
    }

    constructor(
        width: bigint,
        height: bigint,
        tileIdx: TileIdx,
        mines: MineNum = 99n
    ) {
        this.width = width;
        this.height = height;
        this.totMines = Board.getNumMines(width, height, mines);
        this.unclearedSquares = (height * width) - this.totMines;

        let initPair = this.initSquares(tileIdx);
        this.squares = initPair[0];
        this.mines = initPair[1];
        this.gameState = 0;
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

    initSquares(tileIdx: TileIdx): [Array<Array<Square>>, Set<Square>] {
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

        var mines: Set<Square> = new Set();

        for (let tileIdx of mineSquares) {
            let x = tileIdx[0];
            let y = tileIdx[1];

            squares[y][x] = new Square(tileIdx, "mine");
            mines.add(squares[y][x]);
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

        return [squares, mines];
    }

    revealSquare(square: Square): TileRet[] {
        if (this.gameState !== 0) {
            return [];
        }
        square.reveal();
        var ret: TileRet[] = [[square.idx, square.tile]];
        if (square.tile === "mine") {
            this.gameState = -1;
            return ret;
        }
        if (square.tile === "empty") {
            for (let neigh of square.hidden) {
                let neighRet = this.revealSquare(neigh);
                ret = ret.concat(neighRet);
            }
        }

        if (--this.unclearedSquares === 0n) {
            this.gameState = 1;
        }
        return ret;
    }

    revealIdx(tileIdx: TileIdx): TileRet[] {
        let x = tileIdx[0], y = tileIdx[1]
        return this.revealSquare(this.squares[y][x]);
    }

    flagSquare(tileIdx: TileIdx): TileIdx[] {
        if (this.gameState !== 0) {
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
        if (this.gameState !== 0) {
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
        if (this.gameState !== 0) {
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
type Digit = "neg" | number
type Digits = [Digit, Digit, Digit, Digit]
type HTMLDigits = [HTMLElement, HTMLElement, HTMLElement, HTMLElement]

class WebGame {
    doc: Document;
    width: bigint;
    height: bigint;
    game: Game;
    hover: Hover;
    container: HTMLElement;
    face: HTMLElement;
    mines: MineNum;
    remainingMines: number;
    timeSpent: number;
    minesDigs: HTMLDigits;
    timerDigs: HTMLDigits;

    constructor(
        doc: Document,
        width = 20n,
        height = 20n,
        mines: MineNum = 99n,
    ) {
        this.doc = doc;
        this.width = width;
        this.height = height;
        this.mines = mines;
        this.game = null;
        this.hover = null;
        this.container = this.doc.getElementById("game")!;
        this.face = this.doc.getElementById("restart")!;
        this.minesDigs = [
            this.doc.getElementById("mines1")!,
            this.doc.getElementById("mines2")!,
            this.doc.getElementById("mines3")!,
            this.doc.getElementById("mines4")!,
        ]
        this.timerDigs = [
            this.doc.getElementById("timer1")!,
            this.doc.getElementById("timer2")!,
            this.doc.getElementById("timer3")!,
            this.doc.getElementById("timer4")!,
        ]

        this.updateFace();
        
        this.remainingMines = Number(Board.getNumMines(this.width, this.height, this.mines));
        this.timeSpent = 0;

        this.resetDigs(this.remainingMines, this.minesDigs);
        this.resetDigs(this.timeSpent, this.timerDigs);

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
                e.preventDefault();
                if (this.hover !== null) {
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
                this.checkFace();
            }
        }
    }

    emptyClick(tileIdx: TileIdx) {
        if (this.game === null) {
            this.game = new Board(this.width, this.height, tileIdx, this.mines);
            setTimeout(() => this.timer(), 1000);
        }
        let retArr = this.game.revealIdx(tileIdx);
        for (let pair of retArr) {
            let idx = pair[0], num = pair[1];
            this.revealPair(idx, num);
        }
        this.checkFace();
    }

    checkFace() {
        if (this.game !== null && this.game.gameState !== 0) {
            this.updateFace();
        }
    }

    timer() {
        if (this.game === null || this.game.gameState !== 0) {
            return;
        } 
        let prevTime = this.timeSpent;
        this.timeSpent += 1;
        this.updateDigs(prevTime, this.timeSpent, this.timerDigs);
        setTimeout(() => this.timer(), 1000);
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

                // update mine count
                let prevNum = this.remainingMines
                this.remainingMines -= 1;
                this.updateDigs(prevNum, this.remainingMines, this.minesDigs);
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

                // update mine count
                let prevNum = this.remainingMines
                this.remainingMines += 1;
                this.updateDigs(prevNum, this.remainingMines, this.minesDigs);
            }
        }
    }

    genId(tileIdx: TileIdx): Id {
        let x = tileIdx[0], y = tileIdx[1];
        return x.toString() + "_" + y.toString();
    }

    defaultTileAttrs(tileIdx: TileIdx, tile: HTMLElement) {
        tile.classList.add("tile");
        tile.classList.add("hidden")
        tile.id = this.genId(tileIdx);
        tile.onclick = () => {
            this.emptyClick(tileIdx);
        };
        tile.oncontextmenu = () => {
            this.flag(tileIdx);
        };
    }

    genTile(tileIdx: TileIdx) {
        let tile = this.doc.createElement('div');
        this.defaultTileAttrs(tileIdx, tile);
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

    numToDigits(num: number): Digits {
        var dig1: Digit;

        if (num < 0) {
            dig1 = "neg";
        }
        else {
            dig1 = Math.floor(num / 1000) % 10;
        }
        let pos = Math.abs(num);

        let dig2 = Math.floor(pos / 100) % 10;
        let dig3 = Math.floor(pos / 10) % 10;
        let dig4 = pos % 10;
        return [dig1, dig2, dig3, dig4];
    }

    getDigClassName(dig: Digit): string {
        var postPend: string;
        if (dig === "neg") {
            postPend = dig;
        }
        else {
            postPend = dig.toString();
        }
        return "dig_" + postPend;
    }

    getDiffDigs(digs1: Digits, digs2: Digits): [boolean, boolean, boolean, boolean] {
        return [
            digs1[0] !== digs2[0],
            digs1[1] !== digs2[1],
            digs1[2] !== digs2[2],
            digs1[3] !== digs2[3],
        ]
    }

    updateDigs(prevNum: number, newNum: number, digs: HTMLDigits) {
        let prevDigs = this.numToDigits(prevNum);
        let newDigs = this.numToDigits(newNum);

        let diffs = this.getDiffDigs(prevDigs, newDigs);
        for (let i = 0; i < diffs.length; i++) {
            if (diffs[i]) {
                digs[i].classList.remove(this.getDigClassName(prevDigs[i]));
                digs[i].classList.add(this.getDigClassName(newDigs[i]));
            }
        }
    }

    updateFace() {
        if (this.game === null || this.game.gameState === 0) {
            this.face.className = "normal";
        }
        else if (this.game.gameState === 1) {
            this.face.className = "happy";
        }
        else {
            this.face.className = "sad";
        }
    }

    resetDigs(num: number, htmlDigs: HTMLDigits) {
        let digs = this.numToDigits(num);

        for (let i = 0; i < htmlDigs.length; i++) {
            htmlDigs[i].className = 'digit';
            htmlDigs[i].classList.add(this.getDigClassName(digs[i]));
        }
    }

    resetCounters() {
        this.remainingMines = Number(
            Board.getNumMines(this.width, this.height, this.mines));
        this.timeSpent = 0;

        this.resetDigs(this.remainingMines, this.minesDigs);
        this.resetDigs(this.timeSpent, this.timerDigs);
    }

    resetTile(tileIdx: TileIdx) {
        let id = this.genId(tileIdx)
        let tile = this.doc.getElementById(id)!;

        // reset classes
        tile.className = '';

        this.defaultTileAttrs(tileIdx, tile);
    }

    resetBoard() {
        for (let j = 0; j < this.height; j++) {
            for (let i = 0; i < this.width; i++) {
                let tileIdx: TileIdx = [i, j];
                this.resetTile(tileIdx);
            }
        }
    }

    resetGame() {
        this.game = null;
        this.resetBoard();
        this.resetCounters();
        this.updateFace();
    }
}