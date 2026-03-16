@native("printf")
declare function print(format: string, ...args: any): void;

interface Pair<T, U> {
    first: T,
    second: U,
}

function main(): i32 {
    let p: Pair<i32, f64> = { first: 10, second: 3.14 };
    print("%d %f\n", p.first, p.second);
    return 0;
}
