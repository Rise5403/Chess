const alexHeight = 1.77;
const alexWeight = 87.5;
const alexBmi = alexWeight / (alexHeight * alexHeight);
console.log("Alex BMI is = " + alexBmi);

const leslieHeight = 1.5;
const leslieWeight = 58;
const leslieBmi = leslieWeight / (leslieHeight * leslieHeight);
console.log("Leslie BMI is = " + leslieBmi);

if (alexBmi > leslieBmi){
    console.log(alexBmi + " is greater")
} else{
    console.log(leslieBmi + " is greater")
};

emptyArray = [];

for (let i = 0; i <= 10; i++ ){
    prompt(pareseint("Enter Something"))
};