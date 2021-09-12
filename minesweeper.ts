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

    // returns if the flag is correct or not. For used in training mode
    flag(): boolean {
        this.state = "flagged";
        for (let neigh of this.neighs) {
            neigh.add_flag(this);
        }
        return this.tile === "mine";
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
// okay (in training), type of reveal, and tiles affected
type SpaceRet = [boolean, SpaceReveal, TileRet[]]
var defaultSpaceRet: SpaceRet = [true, "reveal", []]
var loseSpaceRet: SpaceRet = [false, "reveal", []]

function setDiff<T>(A: Set<T>, B: Set<T>): Set<T> {
    let ret: Set<T> = new Set();

    for (let a of A) {
        if (!B.has(a)) {
            ret.add(a);
        }
    }

    return ret;
}


class Board {
    width: bigint;
    height: bigint;
    totMines: bigint;
    squares: Array<Array<Square>>;
    mines: Set<Square>;
    flags: Set<Square>;
    unclearedSquares: bigint;
    gameState: GameState;
    training: boolean;

    static NEIGHS: TileIdx[] = [
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
        mines: MineNum = 99n,
        training: boolean,
    ) {
        this.width = width;
        this.height = height;
        this.totMines = Board.getNumMines(width, height, mines);
        this.training = training;
        this.unclearedSquares = (height * width) - this.totMines;

        let initPair = this.initSquares(tileIdx);
        this.squares = initPair[0];
        this.mines = initPair[1];
        this.flags = new Set();
        this.gameState = 0;
    }

    getSquare(tileIdx: TileIdx): Square {
        let x = tileIdx[0], y = tileIdx[1];
        return this.squares[y][x];
    }

    static convert1d2d(idx: number, width: bigint): TileIdx {
        let x = idx % Number(width);
        let y = Math.floor(idx / Number(width));
        return [x, y];
    }

    static convert2d1d(tileIdx: TileIdx, width: bigint): number {
        let x = tileIdx[0], y = tileIdx[1];
        return y * Number(width) + x;
    }

    static getNeighbors(tileIdx: TileIdx, width: bigint, height: bigint): TileIdx[] {
        let x = tileIdx[0], y = tileIdx[1];
        let ret = Board.NEIGHS.map((pair) => {
            let neigh: TileIdx = [pair[0] + x, pair[1] + y];
            return neigh
        }).filter(pair => pair[0] >= 0 && pair[0] < width
            && pair[1] >= 0 && pair[1] < height);

        return ret;
    }

    countAdjacent(tileIdx: TileIdx, mineSquares: Set<number>)
        : Tile {
        let neighs = Board.getNeighbors(tileIdx, this.width, this.height)
            .filter(x => mineSquares.has(Board.convert2d1d(x, this.width)));
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
        let neighbor1d = Board.getNeighbors(tileIdx, this.width, this.height)
            .map(idx => Board.convert2d1d(idx, this.width));
        let safeSquares = new Set(neighbor1d);
        safeSquares.add(Board.convert2d1d(tileIdx, this.width));
        let potentialMines = randomized.filter(x => !safeSquares.has(x));

        var mineSquares = potentialMines.slice(0, Number(this.totMines))
            .map(idx => Board.convert1d2d(idx, this.width));

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

        var mineSet = new Set(mineSquares.map(pair => Board.convert2d1d(pair, this.width)));

        for (let j = 0; j < this.height; j++) {
            for (let i = 0; i < this.width; i++) {
                let idx: TileIdx = [i, j];
                if (mineSet.has(Board.convert2d1d(idx, this.width))) {
                    continue;
                }
                let numMines = this.countAdjacent(idx, mineSet);
                squares[j][i] = new Square(idx, numMines);
            }
        }

        for (let j = 0; j < this.height; j++) {
            for (let i = 0; i < this.width; i++) {
                let idx: TileIdx = [i, j]
                let neighs = Board.getNeighbors(idx, this.width, this.height)
                    .map(pair => squares[pair[1]][pair[0]]);
                squares[j][i].add_hiddens(neighs);
            }
        }

        return [squares, mines];
    }

    revealSquare(square: Square): TileRet[] {
        if (this.gameState !== 0 || square.state == "displayed") {
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

    flagSquare(tileIdx: TileIdx): [boolean, TileIdx[]] {
        if (this.gameState !== 0) {
            return [true, []];
        }
        var square = this.getSquare(tileIdx);
        if (square.state === "hidden") {
            let correctlyFlagged = square.flag();
            this.flags.add(square);
            if (!correctlyFlagged && this.training) {
                this.gameState = -1;
            }
            return [correctlyFlagged, [tileIdx]];
        }
        return [true, []];
    }

    unflagSquare(tileIdx: TileIdx): TileIdx[] {
        if (this.gameState !== 0) {
            return [];
        }
        var square = this.getSquare(tileIdx);
        if (square.state === "flagged") {
            square.unflag();
            this.flags.delete(square);
            // no unflagging in training
            if (this.training) {
                this.gameState = -1;
            }
            return [tileIdx];
        }
        return [];
    }

    revealAround(tileIdx: TileIdx, flag: boolean): SpaceRet {
        if (this.gameState !== 0) {
            return defaultSpaceRet;
        }
        var square = this.getSquare(tileIdx);
        if (square.state === "hidden") {
            if (flag) {
                // though default to true (no lose), could lose to incorrect flag later in checking.
                return [true, "flag", []];
            }
            else {
                return defaultSpaceRet;
            }
        }
        else if (square.state === "flagged") {
            if (flag) {
                return [true, "unflag", []];
            }
            else {
                return defaultSpaceRet;
            }
        }
        else if (this.correctFlagged(tileIdx)) {
            let ret: TileRet[] = new Array();
            for (let neigh of square.hidden) {
                ret = ret.concat(this.revealSquare(neigh));
            }
            // in this case, clicked redundant square (with space). Lose in training.
            if (ret.length == 0 && this.training && flag) {
                this.gameState = -1;
                return loseSpaceRet;
            }
            else {
                return [true, "reveal", ret];
            }
        }
        else {
            // in this case, we miss clicked. In training mode - we lose. Only lose on space rather than double click.
            if (this.training && flag) {
                this.gameState = -1;
                return loseSpaceRet;
            }
            else {
                return defaultSpaceRet;
            }
        }
    }

    // return pair of [incorrect flag, missing flag] squares
    getResults(): [Set<Square>, Set<Square>] {
        let incorrect = setDiff(this.flags, this.mines);
        let missing = setDiff(this.mines, this.flags);

        return [incorrect, missing];
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
    left: boolean;
    right: boolean;
    currHover: Set<number>;
    training: boolean;
    timerCallback: null | number;

    constructor(
        doc: Document,
    ) {
        this.doc = doc;
        this.width = BigInt((<HTMLInputElement>doc.getElementById('width')!).value);
        this.height = BigInt((<HTMLInputElement>doc.getElementById('height')!).value);
        this.mines = BigInt((<HTMLInputElement>doc.getElementById('mines')!).value);
        this.training = this.getTrainingMode();
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
        this.timerCallback = null;

        this.resetDigs(this.remainingMines, this.minesDigs);
        this.resetDigs(this.timeSpent, this.timerDigs);

        this.left = false;
        this.right = false;

        this.currHover = new Set();

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
                    this.spaceClick(this.hover, true);
                }
            }
        });
        this.doc.addEventListener('mousedown', e => {
            switch (e.button) {
                case 0:
                    this.left = true;
                    break;
                case 2:
                    this.right = true;
                    break;
            }
        });
        this.doc.addEventListener('mouseup', e => {
            switch (e.button) {
                case 0:
                    this.unHoverAll();
                    if (this.left && this.right) {
                        this.revealDoubleClick();
                    }
                    else if (this.left) {
                        this.revealSingleClick();
                    }
                    this.left = false;
                    break;
                case 2:
                    this.right = false;
                    break;
            }
        });
    }

    revealSingleClick() {
        if (this.hover !== null) {
            if (this.game === null ||
                this.game.getSquare(this.hover).state === "hidden") {
                this.emptyClick(this.hover);
            }
        }
    }

    getTrainingMode(): boolean {
        let modeVal = (<HTMLInputElement>this.doc.querySelector('input[name="mode"]:checked')!).value;
        if (modeVal === "regular") {
            return false;
        }
        else if (modeVal === "training") {
            return true;
        }
        else {
            console.log("Unrecognized mode. Defaulting to Regular...");
            return false;
        }
    }

    revealDoubleClick() {
        this.currHover.clear();
        if (this.hover !== null) {
            this.spaceClick(this.hover, false);
        }
    }

    hoverTile(tileIdx: TileIdx) {
        this.currHover.add(Board.convert2d1d(tileIdx, this.width));
        let tile = this.getTile(tileIdx);
        if (this.game === null ||
                this.game.getSquare(tileIdx).state === "hidden") {
            tile.classList.remove("hidden");
            tile.classList.add("hover");
        }
    }

    unhoverTile(tileIdx: TileIdx, remove: boolean) {
        let tile = this.getTile(tileIdx);
        if (tile.classList.contains("hover")) {
            tile.classList.remove("hover");
            tile.classList.add("hidden");
        }
        if (remove) {
            this.currHover.delete(Board.convert2d1d(tileIdx, this.width));
        }
    }

    unHoverAll() {
        for (let num of this.currHover) {
            let idx = Board.convert1d2d(num, this.width);
            this.unhoverTile(idx, false);
        }
        this.currHover.clear();
    }

    hoverTiles(tileIdxs: TileIdx[]) {
        let hovers = new Set(
            tileIdxs.map(x => Board.convert2d1d(x, this.width)));
        
        let addHovers = setDiff(hovers, this.currHover);
        let unHovers = setDiff(this.currHover, hovers);

        for (let un of unHovers) {
            this.unhoverTile(Board.convert1d2d(un, this.width), true);
        }

        for (let add of addHovers) {
            this.hoverTile(Board.convert1d2d(add, this.width));
        }
    }

    spaceClick(tileIdx: TileIdx, flag: boolean) {
        if (this.game !== null) {
            let [retOkay, retType, retArr] = this.game.revealAround(tileIdx, flag);
            if (retType === "flag") {
                this.flag(tileIdx);
            }
            else if (retType === "unflag") {
                this.unflag(tileIdx);
            }
            else {
                for (let pair of retArr) {
                    let idx = pair[0], num = pair[1];
                    if (this.revealPair(idx, num)) {
                        break;
                    }
                }
                // check if we training lost or not
                if (retOkay) {
                    this.checkWin();
                }
                else {
                    this.lose(null);
                }
                this.checkFace();
            }
        }
    }

    emptyClick(tileIdx: TileIdx) {
        if (this.game === null) {
            this.game = new Board(this.width, this.height, tileIdx, this.mines, this.training);
            this.timerCallback = setTimeout(() => this.timer(), 1000);
        }
        let retArr = this.game.revealIdx(tileIdx);
        for (let pair of retArr) {
            let idx = pair[0], num = pair[1];
            if (this.revealPair(idx, num)) {
                break;
            }
        }
        this.checkFace();
        this.checkWin();
    }

    checkFace() {
        if (this.game !== null && this.game.gameState !== 0) {
            this.updateFace();
        }
    }

    checkWin() {
        if (this.game !== null && this.game.gameState === 1) {
            this.stopTimer();
            this.updateDigs(this.remainingMines, 0, this.minesDigs);
            this.revealWin();
        }
    }

    timer() {
        if (this.game === null || this.game.gameState !== 0) {
            return;
        } 
        let prevTime = this.timeSpent;
        this.timeSpent += 1;
        this.updateDigs(prevTime, this.timeSpent, this.timerDigs);
        this.timerCallback = setTimeout(() => this.timer(), 1000);
    }

    stopTimer() {
        if (this.timerCallback !== null) {
            clearTimeout(this.timerCallback);
        }
    }

    removeAttrs(tileIdx: TileIdx, tile: HTMLElement, reveal: boolean) {
        tile.onmousedown = e => {
            this.tileMouseDown(tileIdx, "displayed", e);
        };
        if (reveal) {
            this.revealTile(tile);
        }
    }

    revealTile(tile: HTMLElement) {
        tile.classList.remove("hidden");
        tile.classList.add("revealed");
    }

    // true if lost, false else
    revealPair(tileIdx: TileIdx, num: Tile): boolean {
        let tile = this.getTile(tileIdx);
        this.removeAttrs(tileIdx, tile, true);
        if (num === "mine") {
            this.lose(tileIdx);
            return true;
        }
        else if (num === "empty") {
            return false;
        }
        else {
            tile.classList.add("num_" + num.toString());
            return false;
        }
    }

    lose(tileIdx: null | TileIdx) {
        this.stopTimer();

        if (tileIdx !== null) {
            let tile = this.getTile(tileIdx);
            tile.classList.add("lose");
            tile.classList.add("mine");
        }
        this.revealLose(tileIdx);
    }

    revealLose(tileIdx: null | TileIdx) {
        if (this.game === null) {
            return;
        }

        let [incorrect, missing] = this.game.getResults();
        if (tileIdx !== null) {
            let loseSquare = this.game.getSquare(tileIdx);
            missing.delete(loseSquare);
        }
        

        for (let inc of incorrect) {
            let tile = this.getTile(inc.idx);
            if (tileIdx !== null) {
                this.removeAttrs(tileIdx, tile, true);
            }
            tile.classList.remove("flagged");
            tile.classList.add("no_mine");
        }

        for (let miss of missing) {
            let tile = this.getTile(miss.idx);
            if (tileIdx !== null) {
                this.removeAttrs(tileIdx, tile, true);
            }
            tile.classList.add("mine");
        }
    }

    revealWin() {
        if (this.game === null) {
            return;
        }

        let results = this.game.getResults();
        let missing = results[1];

        for (let miss of missing) {
            let tile = this.getTile(miss.idx);
            this.removeAttrs(miss.idx, tile, false);
            tile.classList.add("flagged");
        }
    }

    // true for safe, false for lost
    flag(tileIdx: TileIdx) {
        if (this.game === null) {
            return;
        }
        else {
            let [correctlyFlagged, ret] = this.game.flagSquare(tileIdx);
            for (let pair of ret) {
                let tile = this.getTile(pair);
                tile.onmousedown = e => {
                    this.tileMouseDown(tileIdx, "flagged", e);
                };
                tile.classList.add("flagged");

                // update mine count
                let prevNum = this.remainingMines
                this.remainingMines -= 1;
                this.updateDigs(prevNum, this.remainingMines, this.minesDigs);
            }

            // check if we lost in training mode
            if (!correctlyFlagged && this.training) {
                this.lose(null);
                this.checkFace();
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
                let tile = this.getTile(pair);
                tile.onmousedown = e => {
                    this.tileMouseDown(tileIdx, "hidden", e);
                };
                tile.classList.remove("flagged");

                // update mine count
                let prevNum = this.remainingMines
                this.remainingMines += 1;
                this.updateDigs(prevNum, this.remainingMines, this.minesDigs);
            }
            if (ret.length > 0) {
                this.lose(null);
                this.checkFace();
            }
        }
    }

    genId(tileIdx: TileIdx): Id {
        let x = tileIdx[0], y = tileIdx[1];
        return x.toString() + "_" + y.toString();
    }

    getTile(tileIdx: TileIdx): HTMLElement {
        let id = this.genId(tileIdx);
        return this.doc.getElementById(id)!;
    }

    defaultTileAttrs(tileIdx: TileIdx, tile: HTMLElement) {
        tile.classList.add("tile");
        tile.classList.add("hidden")
        tile.onmousedown = e => {
            this.tileMouseDown(tileIdx, "hidden", e);
        };
        tile.onmouseover = () => {
            this.hover = tileIdx;
            if (this.left && this.right) {
                this.hoverAround(tileIdx);
            }
            else if (this.left) {
                this.hoverSingle(tileIdx);
            }
        }
    }

    tileMouseDown(tileIdx: TileIdx, state: State, e: MouseEvent) {
        switch (e.button) {
            case 0:
                if (this.right) {
                    this.hoverAround(tileIdx);
                }
                else {
                    this.hoverSingle(tileIdx);
                }
                break;
            case 2:
                if (this.left) {
                    this.hoverAround(tileIdx);
                }
                else {
                    switch (state) {
                        case "hidden":
                            this.flag(tileIdx);
                            break;
                        case "displayed":
                            break;
                        case "flagged":
                            this.unflag(tileIdx);
                    }
                }
        }
    }

    hoverSingle(tileIdx: TileIdx) {
        this.hoverTiles([tileIdx]);
    }

    hoverAround(tileIdx: TileIdx) {
        let neighs = Board.getNeighbors(tileIdx, this.width, this.height);
        neighs.push(tileIdx);
        this.hoverTiles(neighs);
    }

    genTile(tileIdx: TileIdx) {
        let tile = this.doc.createElement('div');
        tile.id = this.genId(tileIdx);
        this.defaultTileAttrs(tileIdx, tile);
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

    deleteBoard() {
        var board = this.doc.getElementById("game")!;
        while (board.firstChild !== null) {
            board.removeChild(board.firstChild);
        }
    }

    numToDigits(num: number): Digits {
        var dig1: Digit, dig2: Digit, dig3: Digit, dig4: Digit;
        let minNum = -999;
        let maxNum = 9999;

        if (num <= minNum) {
            dig1 = "neg";
            dig2 = 9;
            dig3 = 9;
            dig4 = 9;
        }
        else if (num >= maxNum) {
            dig1 = 9;
            dig2 = 9;
            dig3 = 9;
            dig4 = 9;
        }
        else {
            if (num < 0) {
                dig1 = "neg";
            }
            else {
                dig1 = Math.floor(num / 1000) % 10;
            }
            let pos = Math.abs(num);
    
            dig2 = Math.floor(pos / 100) % 10;
            dig3 = Math.floor(pos / 10) % 10;
            dig4 = pos % 10;
        }
        
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
        let tile = this.getTile(tileIdx);

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
        this.stopTimer();
        this.resetBoard();
        this.resetCounters();
        this.updateFace();
    }
}
