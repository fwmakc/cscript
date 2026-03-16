@native("printf")
declare function print(format: string, ...args: any): void;

function takeOwnership(s: string): void {
    print("Got: %s\n", s);
}

function main(): i32 {
    let s: string = "hello";
    takeOwnership(s);
    print("After: %s\n", s);
    return 0;
}
