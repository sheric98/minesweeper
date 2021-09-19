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

    get_num(): null | number {
        if (this.tile === "mine") {
            return null;
        }
        else if (this.tile === "empty") {
            return 0;
        }
        else {
            return this.tile;
        }
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
    probModel: ProbModelWorker;
    gameId: number[];

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
        webGame: WebGame,
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

        let idSize = Math.ceil(Number(this.height * this.width) / 53);
        this.gameId = Array(idSize).fill(0)

        this.probModel = new ProbModelWorker(webGame);
        let nums = this.squares.map(row => row.map(square => square.get_num()));
        this.probModel.postMessage({init: [this.totMines, nums]});
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

    updateId(square: Square) {
        let flatIdx = Board.convert2d1d(square.idx, this.width);
        let arrIdx = Math.floor(flatIdx / 53);
        let internalIdx = flatIdx % 53;
        this.gameId[arrIdx] += (1 << internalIdx);
    }

    revealSquare(square: Square): TileRet[] {
        if (this.gameState !== 0 || square.state == "displayed") {
            return [];
        }
        square.reveal();
        this.updateId(square);
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
        let x = tileIdx[0], y = tileIdx[1];
        let tileRet = this.revealSquare(this.squares[y][x]);
        this.probModel.postTileRet(tileRet);
        return tileRet; 
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
                // update model
                this.probModel.postTileRet(ret);
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

    gameIdEquals(checkId: number[]): boolean {
        return checkId.length === this.gameId.length && checkId.every((num, idx) => num == this.gameId[idx]);
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
    startingTime: number;
    currRequest: null | RequestMessage;
    requestIdxs: Set<TileIdx>;
    requestIdxsType: null | RequestMessage;

    static requestToClassName: Map<RequestMessage, String> = new Map([
        ["safes", "prob_safe"],
        ["flags", "prob_flag"],
        ["lowest", "prob_lowest"],
    ]);

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
        this.startingTime = -1;
        this.timerCallback = null;

        this.resetDigs(this.remainingMines, this.minesDigs);
        this.resetDigs(this.timeSpent, this.timerDigs);

        this.left = false;
        this.right = false;

        this.currHover = new Set();
        this.currRequest = null;
        this.requestIdxs = new Set();
        this.requestIdxsType = null;

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
                this.removeRequest();
                this.flag(tileIdx);
            }
            else if (retType === "unflag") {
                this.removeRequest();
                this.unflag(tileIdx);
            }
            else {
                if (retArr.length > 0) {
                    this.removeRequest();
                }
                this.processTileRets(retArr);
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

    startGame(tileIdx: TileIdx) {
        this.game = new Board(this.width, this.height, tileIdx, this.mines, this.training, this);
        this.startingTime = Date.now();
        this.timerCallback = setTimeout(() => this.timer(), 1000);
    }

    emptyClick(tileIdx: TileIdx) {
        if (this.game === null) {
            this.startGame(tileIdx);
        }
        let retArr = this.game!.revealIdx(tileIdx);
        if (retArr.length > 0) {
            this.removeRequest();
        }
        this.processTileRets(retArr);
        
        this.checkFace();
        this.checkWin();
    }

    processTileRets(tileRets: TileRet[]) {
        if (this.game!.gameState == -1) {
            let [loseIdx, _] = tileRets.find(pair => pair[1] === "mine")!;
            this.lose(loseIdx);
        }
        else {
            tileRets.forEach(pair => this.revealPair(pair[0], pair[1]));
        }
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
        let nextUpdate = this.timeSpent + 1;
        this.updateDigs(prevTime, this.timeSpent, this.timerDigs);
        let milliToWait = this.startingTime + (nextUpdate * 1000) - Date.now();
        this.timerCallback = setTimeout(() => this.timer(), milliToWait);
    }

    stopTimer() {
        if (this.timerCallback !== null) {
            clearTimeout(this.timerCallback);
            this.timerCallback = null;
            this.startingTime = -1;
            this.timeSpent = 0;
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
            if (this.training && ret.length > 0) {
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
        this.currRequest = null;
        this.requestIdxsType = null;
        this.requestIdxs.clear();
        this.stopTimer();
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

    removeRequestSquares() {
        // assume only have request squares active if request type is not null
        if (this.requestIdxsType !== null) {
            let classType = WebGame.requestToClassName.get(this.requestIdxsType)!.valueOf();
            this.requestIdxs.forEach(idx => this.getTile(idx).classList.remove(classType));
            this.requestIdxs.clear();
        }
    }

    removeRequest() {
        this.currRequest = null;
        this.removeRequestSquares();
    }

    makeRequest(request: RequestMessage) {
        if (this.game !== null) {
            this.currRequest = request;
            this.game.probModel.postRequest(request);
            this.removeRequestSquares();
        }
    }

    receiveResponse(type: RequestMessage, gameId: number[], squares: TileIdx[]) {
        if (this.game !== null && type === this.currRequest && this.game.gameIdEquals(gameId)) {
            let classType = WebGame.requestToClassName.get(type)!.valueOf();
            squares.forEach(idx => {
                this.getTile(idx).classList.add(classType);
                this.requestIdxs.add(idx);
            });
            this.requestIdxsType = type;
        }
    }
}

// Direct interaction

var webGame: null | WebGame = null;
window.onload = () => {
    webGame = new WebGame(document);
    webGame.genBoard();
};

function create() {
    if (webGame !== null) {
        webGame.deleteBoard();
    }
    webGame = new WebGame(document);
    webGame.genBoard();
}

function getSafes() {
    if (webGame !== null) {
        webGame.makeRequest("safes");
    }
}

function getFlags() {
    if (webGame !== null) {
        webGame.makeRequest("flags");
    }
}

function getLowest() {
    if (webGame !== null) {
        webGame.makeRequest("lowest");
    }
}


/* WEB_WORKER INTERACTION */
type NumOrNull = null | number;
type RequestMessage = "safes" | "flags" | "lowest";
type InitMessage = [bigint, NumOrNull[][]]

interface MessageObj {
    init?: InitMessage;
    reveal?: TileIdx[];
    request?: RequestMessage;
}

interface ResponseObj {
    type: RequestMessage;
    gameId: number[];
    squares: TileIdx[];
}

class ProbModelWorker {
    worker: Worker;

    static interaction() {
        /* PROB_MODEL WEB WORKER */

        type SquareNum = null | number;
        type SquareIdx = [number, number];
        type MinesAndSafes = [Set<ProbSquare>, Set<ProbSquare>];

        class ProbSquare {
            num: null | number;
            neighs: Set<ProbSquare>;
            hiddenNeighs: Set<ProbSquare>;
            idx: SquareIdx;

            constructor(num: SquareNum) {
                this.num = num;
                this.neighs = new Set();
                this.hiddenNeighs = new Set();
                this.idx = [0, 0];
            }

            addNeighs(neighs: Set<ProbSquare>) {
                this.neighs = new Set(neighs);
                this.hiddenNeighs = new Set(neighs);
            }

            setIdx(idx: SquareIdx) {
                this.idx = idx;
            }

            reveal() {
                this.neighs.forEach(neigh => neigh.hiddenNeighs.delete(this));
            }
        }

        class ProbBoard {
            board: ProbSquare[][];
            width: number;
            height: number;
            gameId: number[];

            static NEIGHS: SquareIdx[] = [
                [1, 1], [1, 0], [1, -1],
                [0, 1], [0, -1],
                [-1, 1], [-1, 0], [-1, -1]
            ];

            constructor(nums: SquareNum[][]) {
                this.board = nums.map(row => row.map(num => new ProbSquare(num)));
                this.height = nums.length;
                this.width = nums.length > 0 ? nums[0].length : 0;
                let idSize = Math.ceil((this.height * this.width) / 53);
                this.gameId = Array(idSize).fill(0)

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        let idx: SquareIdx = [x, y];
                        this.getSquare(idx).addNeighs(this.getNeighs(idx));
                        this.getSquare(idx).setIdx(idx);
                    }
                }
            }

            inBoard(idx: SquareIdx): boolean {
                let [x, y] = idx;
                return x >= 0 && x < this.width && y >= 0 && y < this.height;
            }

            getSquare(idx: SquareIdx): ProbSquare {
                let [x, y] = idx;
                return this.board[y][x];
            }

            getNeighs(idx: SquareIdx): Set<ProbSquare> {
                let [x, y] = idx;
                let squareArr = ProbBoard.NEIGHS
                    .map(neigh => <SquareIdx> [x + neigh[0], y + neigh[1]])
                    .filter(idx => this.inBoard.bind(this)(idx))
                    .map(idx => this.getSquare.bind(this)(idx));
                return new Set(squareArr);
            }

            updateArr(idx: SquareIdx) {
                let [x, y] = idx;
                let flatIdx = y * this.width + x;
                let arrIdx = Math.floor(flatIdx / 53);
                let internalIdx = flatIdx % 53;
                this.gameId[arrIdx] += (1 << internalIdx);
            }
        }

        function comb_and_comp<T>(lst: T[], n: number): null | [T[], T[]][] {
            var fn = function(active: T[], unused: T[], rest: T[], n: number, a: [T[], T[]][]) {
                if (active.length + rest.length < n) {
                    return;
                }
                if (active.length == n) {
                    a.push([active, unused.concat(rest)]);
                }
                else {
                    fn(active.concat([rest[0]]), unused, rest.slice(1), n, a);
                    fn(active, unused.concat([rest[0]]), rest.slice(1), n, a);
                }
            }

            // error checking.
            if (n > lst.length) {
                return null;
            }

            let ret: [T[], T[]][] = []
            fn([], [], lst, n, ret);
            return ret;
        }

        class Chain {
            maxMines: bigint;
            mines: Set<ProbSquare>;
            newMines: Set<ProbSquare>;
            safe: Set<ProbSquare>;
            parent: null | Chain;
            children: Set<Chain>
            leaves: number;
            leafChains: Chain[];

            constructor(totMines: bigint) {
                this.maxMines = totMines;
                this.mines = new Set();
                this.newMines = new Set();
                this.safe = new Set();
                this.parent = null;
                this.children = new Set();
                this.leaves = 1;
                this.leafChains = [this];
            }

            calculateLeaves() {
                if (this.children.size == 0) {
                    this.leaves = 1;
                    this.leafChains = [this];
                }
                else {
                    let totLeaves = 0;
                    let leafChains: Chain[] = [];
                    for (let child of this.children) {
                        child.calculateLeaves()
                        totLeaves += child.leaves;
                        child.leafChains.forEach(chain => leafChains.push(chain));
                    }
                    this.leaves = totLeaves;
                    this.leafChains = leafChains;
                }
            }

            // return avail numbers as well as adjacent mines
            availNeighs(square: ProbSquare): [ProbSquare[], number] {
                var ret = []
                var adjMines = 0;
                for (let neigh of square.hiddenNeighs) {
                    if (this.mines.has(neigh)) {
                        adjMines++;
                    }
                    else if (!this.safe.has(neigh)) {
                        ret.push(neigh);
                    }
                }
                return [ret, adjMines];
            }

            extendMinesAndSafes(square: ProbSquare, minesAndHiddens: MinesAndSafes[]): MinesAndSafes[] {
                let [availNeighs, adjMines] = this.availNeighs(square);
                return minesAndHiddens.flatMap(minesAndHidden =>
                    this.extendSingleMinesAndSafes(square, availNeighs, adjMines, minesAndHidden));
            }

            extendSingleMinesAndSafes(square: ProbSquare, availNeighs: ProbSquare[], adjMines: number, singleMinesAndSafes: MinesAndSafes): MinesAndSafes[] {
                let [currMines, currHidden] = singleMinesAndSafes;
                let currAvailNeighs: ProbSquare[] = [];
                let currAdjMines = adjMines;
                availNeighs.forEach(neigh => {
                    if (currMines.has(neigh)) {
                        currAdjMines++;
                    }
                    else if (!currHidden.has(neigh)) {
                        currAvailNeighs.push(neigh);
                    }
                });

                let tileNum = square.num!;
                let neededMines = tileNum - currAdjMines;

                if (neededMines < 0 || currAvailNeighs.length < neededMines
                    || this.mines.size + currMines.size + neededMines > this.maxMines) {
                    return [];
                }
                else {
                    let combinations = comb_and_comp(currAvailNeighs, neededMines)!;
                    return combinations.map(pair =>
                        [new Set([...currMines, ...pair[0]]), new Set([...currHidden, ...pair[1]])]);
                }
            }

            getSquaresExtensions(squares: ProbSquare[]): MinesAndSafes[] {
                var currMinesAndSafes: MinesAndSafes[] = [[new Set(), new Set()]];

                squares.forEach(square => currMinesAndSafes = this.extendMinesAndSafes(square, currMinesAndSafes));
                return currMinesAndSafes;
            }

            // returns pair of [new chain, added mines]
            addChild(minesAndSafes: MinesAndSafes): Chain {
                let [newMines, newSafes] = minesAndSafes;
                var child = new Chain(this.maxMines);
                child.mines = new Set(this.mines);
                child.safe = new Set(this.safe);
                newMines.forEach(square => {
                    child.mines.add(square);
                    child.newMines.add(square);
                });
                newSafes.forEach(square => child.safe.add(square));
                child.parent = this;
                this.children.add(child);

                return child;
            }

            // returns list of [new chain, new mines] pairs
            enumerateChain(squares: ProbSquare[]): Chain[] {
                let combinations = this.getSquaresExtensions(squares);

                // add all children.
                let ret = combinations.map(combo => this.addChild(combo));
                
                return ret;
            }

            // return new children for this leaf
            updateLeafChain(squares: ProbSquare[]): Chain[] {
                return this.enumerateChain(squares);
            }

            // return chains to add and chains to delete
            updateChain(squares: ProbSquare[]): [Chain[], Chain[]] {
                // check validity
                let updates: Chain[] = [];
                let deletes: Chain[] = [];

                for (let leafChain of this.leafChains) {
                    let leafUpdates = leafChain.updateLeafChain(squares);
                    // if no children, delete this branch
                    if (leafUpdates.length == 0) {
                        deletes.push(leafChain);
                    }
                    else {
                        leafUpdates.forEach(updChain => updates.push(updChain));
                    }
                }

                return [updates, deletes];
            }

            removeChainFromMap(map: Map<ProbSquare, Set<Chain>>) {
                for (let square of this.newMines) {
                    map.get(square)!.delete(this);
                }
                this.children.forEach(child => child.removeChainFromMap(map));
            }

            removeChain(map: Map<ProbSquare, Set<Chain>>) {
                // stop at the root. Shouldn't ever get here.
                if (this.parent === null) {
                    return;
                }
                // remove parent instead if only child left.
                if (this.parent.children.size <= 1) {
                    this.parent.removeChain(map);
                    return;
                }
                this.parent!.children.delete(this);

                // remove self from map (inlcuding children)
                this.removeChainFromMap(map);
            }
        }

        class ChainManager {
            mineToChains: Map<ProbSquare, Set<Chain>>;
            root: Chain;
            squaresInChain: Set<ProbSquare>;
            unused: Set<ProbSquare>;
            revealed: Set<ProbSquare>;
            maxMines: bigint;
            board: ProbBoard;

            constructor(board: ProbBoard, maxMines: bigint) {
                this.board = board;
                let squares = this.board.board.flat();
                this.mineToChains = new Map();
                this.unused = new Set();
                for (let square of squares) {
                    this.mineToChains.set(square, new Set());
                    this.unused.add(square);
                }
                this.root = new Chain(maxMines);
                this.squaresInChain = new Set();
                this.revealed = new Set();
                this.maxMines = maxMines;
            }

            updateChain(update: Chain) {
                update.newMines.forEach(mine => this.mineToChains.get(mine)!.add(update));
            }

            // returns the average number of mines used
            updateChains(updates: Chain[]): number {
                let totMines = 0;
                for (let update of updates) {
                    this.updateChain(update);
                    totMines += update.mines.size;
                }
                return totMines / updates.length;
            }

            deleteChains(chains: Iterable<Chain>) {
                for (let chain of chains) {
                    chain.removeChain(this.mineToChains);
                }
            }

            // return "hidden" neighbors at the time of this operation
            updateSquaresInChainsAndRevealed(squares: ProbSquare[]) {
                squares.forEach(square => {
                    this.squaresInChain.delete(square);
                    this.revealed.add(square);
                    this.unused.delete(square);
                    square.reveal();
                });

                let hiddens: Set<ProbSquare> = new Set()
                squares.forEach(square => square.hiddenNeighs.forEach(hid => hiddens.add(hid)));
                hiddens.forEach(neigh => {
                    this.squaresInChain.add(neigh);
                    this.unused.delete(neigh);
                });
            }

            // return in order safe, flags, lowest_prob
            getSafeFlagLowest(avgMines: number): [Set<ProbSquare>, Set<ProbSquare>, Set<ProbSquare>]
            {
                let lowest = Number.MAX_SAFE_INTEGER;
                let lowestMines: Set<ProbSquare> = new Set();
                let flags: Set<ProbSquare> = new Set();
                let safes: Set<ProbSquare>;
                let totalChains = this.root.leaves;
                let avgUnusedMines = (Number(this.maxMines) - avgMines) / this.unused.size;

                // only have to check squares in the chain
                for (let square of this.squaresInChain) {
                    let chains = this.mineToChains.get(square)!;
                    let mineCount = this.totalChainCount(chains);

                    if (mineCount < lowest) {
                        lowest = mineCount;
                        lowestMines.clear();
                        lowestMines.add(square);
                    }
                    else if (mineCount == lowest) {
                        lowestMines.add(square);
                    }

                    if (mineCount == totalChains) {
                        flags.add(square);
                    }
                }

                // lowest are all safe
                if (lowest == 0) {
                    safes = new Set(lowestMines);
                }
                else {
                    safes = new Set();
                }

                let EPSILON = 0.0001;
                // potentially lowest
                // essentially equal
                if (Math.abs(lowest - avgUnusedMines) < EPSILON) {
                    this.unused.forEach(square => lowestMines.add(square));
                }
                else if (lowest > avgUnusedMines) {
                    lowestMines = new Set(this.unused);
                }

                // check if unusedMines is 0. if so, add to safes
                if (avgUnusedMines < EPSILON) {
                    this.unused.forEach(square => safes.add(square));
                }

                // check if unusedMines is close to total number of unused tiles
                if (Math.abs(avgUnusedMines - this.unused.size) < EPSILON) {
                    this.unused.forEach(square => flags.add(square));
                }

                return [safes, flags, lowestMines];
            }

            totalChainCount(chains: Set<Chain>): number {
                let count = 0;
                for (let chain of chains) {
                    count += chain.leaves;
                }
                return count;
            }

            // deleting only based on mines that exist
            deleteInvalidMineChains(squares: ProbSquare[]) {
                squares.forEach(square => this.deleteChains(this.mineToChains.get(square)!));
            }

            // reveal a given square to be safe.
            // return new safe squares, flag squares, and lowest_prob squares
            revealSquares(squareIdxs: SquareIdx[]): [Set<ProbSquare>, Set<ProbSquare>, Set<ProbSquare>] {
                let squares = squareIdxs.map(squareIdx => this.board.getSquare(squareIdx))
                                        .filter(square => !this.revealed.has(square));
                                        
                // first remove all chains that have this square as a mine
                this.deleteInvalidMineChains(squares);

                // update leaves again after deleting
                this.root.calculateLeaves();

                // next update our chain / revealed data
                this.updateSquaresInChainsAndRevealed(squares);

                // then try updating remainging chains
                let [updates, deletes] = this.root.updateChain(squares);

                // delete all the chains to now delete
                this.deleteChains(deletes);

                // update map
                let avgMines = this.updateChains(updates);

                this.root.calculateLeaves();

                return this.getSafeFlagLowest(avgMines);
            }
        }

        class ProbModel {
            chainManager: ChainManager;
            board: ProbBoard;
            safes: Set<ProbSquare>;
            lowest: Set<ProbSquare>;
            flags: Set<ProbSquare>;

            constructor(nums: SquareNum[][], maxMines: bigint) {
                this.board = new ProbBoard(nums);
                this.chainManager = new ChainManager(this.board, maxMines);
                this.safes = new Set();
                this.lowest = new Set();
                this.flags = new Set();
            }

            addSquares(squareIdxs: SquareIdx[]) {
                if (squareIdxs.length > 0) {
                    let [safes, flags, lowest] = this.chainManager.revealSquares(squareIdxs);
                    this.safes = safes;
                    this.flags = flags;
                    this.lowest = lowest;
    
                    squareIdxs.forEach(squareIdx => this.board.updateArr(squareIdx));
                }
            }

            fulfillRequest(request: RequestMessage): Set<ProbSquare> {
                if (request === "safes") {
                    return this.safes;
                }
                else if (request === "flags") {
                    return this.flags;
                }
                else {
                    return this.lowest;
                }
            }
        }

        var probModel: null | ProbModel = null;

        onmessage = function(e) {
            let messageObj = <MessageObj> e.data;

            if (messageObj.init !== undefined) {
                let [maxMines, nums] = messageObj.init;
                probModel = new ProbModel(nums, maxMines);
            }

            else if (messageObj.reveal !== undefined) {
                probModel!.addSquares(messageObj.reveal);
            }

            else if (messageObj.request !== undefined) {
                let squares = probModel!.fulfillRequest(messageObj.request);
                let idxs: SquareIdx[] = [];
                squares.forEach(square => idxs.push(square.idx));
                postMessage({
                    squares: idxs,
                    type: messageObj.request,
                    gameId: probModel!.board.gameId,
                });
            }
        };
    }

    static convertFnToWorkerStr(fn: Function) {
        let origStr = fn.toString();
        let lparen = origStr.indexOf('(');
        if (lparen < 0) {
            console.log('Cannot convert function string. Returning original');
            return origStr;
        }
        else {
            return 'function' + origStr.substring(lparen);
        }
    }

    constructor(webGame: WebGame) {
        let blobURL = URL.createObjectURL(new Blob(
            ['(', ProbModelWorker.convertFnToWorkerStr(ProbModelWorker.interaction), ")()"],
            {type: "application/javascript"})
        );
        this.worker = new Worker(blobURL);
        this.worker.onmessage = (event) => ProbModelWorker.receiveMessage(webGame, event);
        URL.revokeObjectURL(blobURL);
    }

    static receiveMessage(webGame: WebGame, event: MessageEvent<any>) {
        let responseObj = <ResponseObj> event.data;
        webGame.receiveResponse(responseObj.type, responseObj.gameId, responseObj.squares);
    }

    postMessage(message: MessageObj) {
        this.worker.postMessage(message);
    }

    postTileRet(tileRets: TileRet[]) {
        let messageIdxs: TileIdx[] = [];
        for (let [idx, tile] of tileRets) {
            if (tile === "mine") {
                // don't update losses
                return;
            }
            else {
                messageIdxs.push(idx);
            }
        }
        this.postMessage({reveal: messageIdxs});
    }

    postRequest(request: RequestMessage) {
        this.postMessage({request: request});
    }
}
