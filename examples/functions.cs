@native("printf")
declare function print(format: string, ...args: any): void;

function add(a: i32, b: i32): i32 {
    return a + b;
}

function multiply(x: i32, y: i32): i32 {
    return x * y;
}

function main(): i32 {
    let sum: i32 = add(3, 5);
    let product: i32 = multiply(sum, 2);
    print("Sum: %d, Product: %d\n", sum, product);
    return 0;
}
