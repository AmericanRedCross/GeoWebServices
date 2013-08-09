//admin_test_page.js
//This code will simulate a search and return a search result object.
//This is only meant as a placeholder for the final search form that will be wired to live data.
$(function () {

    var mockResult = {};
    
    $("#btnSearch").click(function () {
        //Pretend we're doing a search.

        //return an object that mocks the actual server's return JSON object.
        mockResult.id = 1423;
        mockResult.datasource = "GADM"
        mockResult.startYear = "2012";
        mockResult.endYear = "2013";
        mockResult.levels = [];
        mockResult.levels.push({ level: "0", name: "United States of America", geom: null });
        mockResult.levels.push({ level: "1", name: "Washington", geom: null });
        mockResult.levels.push({ level: "2", name: "King", geom: null });
        mockResult.levels.push({ level: "3", name: "City of Seattle", geom: null });
        mockResult.levels.push({ level: "4", name: "Ballard", geom: null });
        mockResult.levels.push({ level: "5", name: "Downtown Ballard", geom: null });

        displayResult(mockResult);

    });

    //When user clicks OK, we close the window and send back the JSON object to the calling window.
    $("#btnOK").click(function () {
        if (window && window.opener) {
            //acceptAdminNames is just a placeholder for a function in SalesForce that can accept a JSON object as the result.
            window.opener.acceptAdminNames(mockResult);
        }
    });

    function displayResult(result) {
        //Clear results
        $(".results").html("");

        var outputHTML = [];

        //Build string
        $.each(result.levels, function (idx, item) {
            outputHTML.push(item.name);
        });

        //Display
        $(".results").html(outputHTML.join("<br/>"));
    }
});