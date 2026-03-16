@native("printf")
declare function print(format: string, ...args: any): void;

function borrowString(s: string): void {
    print("Got: %s\n", s);
}

function main(): i32 {
    let s: string = "hello";
    borrowString(&s);
    print("Still valid: %s\n", &s);
    return 0;
}
