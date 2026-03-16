@native("printf")
declare function print(format: string, ...args: any): void;

class Player {
    x: i32 = 0,
    y: i32 = 0,
    
    move(dx: i32, dy: i32): void {
        this.x += dx;
        this.y += dy;
    }
}

function main(): i32 {
    let player = new Player();
    player.move(10, 20);
    print("Player: %d, %d\n", player.x, player.y);
    return 0;
}
