/* dolphins = [96, 108, 89];

total = 0;
numbersInArray = dolphins.length;

for (var i in dolphins){
    total += dolphins[i]
};

average = total / numbersInArray;


//Variable creations
userArray = [];
sumUserArray = 0

//while loop to prompt the user 3 times for a number
while(userArray.length < 3){
    userArray.push(parseFloat(prompt('Enter a number')));
};

//Testing if the loop worked
console.log(userArray);

//adding up the numbers in the array that we got from the user + Current error(The data being gathered are being pushed as strings and can't convert to numbers)
for (var i in userArray){
    sumUserArray += userArray[i]
};

//getting the number of elements in the array by using the array's length
numbersInUserArray = userArray.length;


//calculating the average and running the console
averageUserArray = sumUserArray / numbersInUserArray;

console.log(averageUserArray);

*/