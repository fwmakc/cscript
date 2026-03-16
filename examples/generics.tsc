@native("printf")
declare function print(format: string, ...args: any): void;

function identity<T>(x: T): T {
    return x;
}

function main(): i32 {
    let a: i32 = identity<i32>(42);
    let b: f64 = identity<f64>(3.14);
    print("%d %f\n", a, b);
    return 0;
}
