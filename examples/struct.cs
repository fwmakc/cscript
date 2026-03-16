@native("printf")
declare function print(format: string, ...args: any): void;

interface Point {
    x: f64,
    y: f64,
}

function main(): i32 {
    let p: Point = { x: 10.5, y: 20.3 };
    print("Point: %f, %f\n", p.x, p.y);
    return 0;
}
