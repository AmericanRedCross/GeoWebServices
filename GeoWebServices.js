
/**
 * Module dependencies.
 */
var pg = require('pg');

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , path = require('path')
  , flow = require('flow')
  , rest = require('./custom_modules/getJSON')
  , settings = require('./settings')
  , loggly = require('loggly');

var app = express();

//Array to hold functions for routes
var routes = [];

//PostGres Connection String
var conString = "postgres://" + settings.pg.username + ":" + settings.pg.password + "@" + settings.pg.server + ":" + settings.pg.port + "/" + settings.pg.database;

//Configure Loggly (logging API)
var config = {
    subdomain: settings.loggly.subdomain,
    auth: {
        username: settings.loggly.username,
        password: settings.loggly.password
    }
};

//Loggly client
var logclient = loggly.createClient(config);

// all environments
app.set('port', process.env.PORT || settings.application.port);
app.set('views', __dirname + '/views'); 
app.set('view engine', 'jade');
app.enable("jsonp callback");
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(express.cookieParser('your secret here'));
app.use(express.session());
app.use(app.router);
app.use(require('less-middleware')({ src: __dirname + '/public' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use("/public/javascript", express.static(path.join(__dirname, 'public/javascript')));
app.use("/public/search", express.static(path.join(__dirname, 'public/html_test')));
app.use(function (err, req, res, next) {
    console.error(err.stack);
    log(err.message);
    res.send(500, 'There was an error with the web service. Please try your operation again.');
    log('There was an error with the web servcice. Please try your operation again.');
});


// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
}

//Define Routes
//List available operations - default screen
routes['listServices'] = function (req, res) {

    //object with available services
    var opslist = [
                   { link: 'nameSearch', name: 'Name search' },
                   { link: 'getAdminStack', name: 'Get Administrative Levels' }
                  ];

    //send to view
    res.render('services', { baseURL: req.url, title: 'RedCross GeoWebServices', opslist: opslist, breadcrumbs: [{ link: "/services", name: "Home" }] })

};

//Name search is a method that will accept a searchterm and return 0 to many results.  It will NOT return admin levels for the matched term.
//It will simply list possible matches for the search term.  
routes['nameSearch'] = flow.define(

    function (req, res) {
        //Stash the node request and response objects.
        this.req = req;
        this.res = res;

        //Grab POST or QueryString args depending on type
        if (this.req.method.toLowerCase() == "post") {
            //If a post, then arguments will be members of the this.req.body property
            this.args = this.req.body;
        }
        else if (this.req.method.toLowerCase() == "get") {
            //If request is a get, then args will be members of the this.req.query property
            this.args = this.req.query;
        }

        //Detect if args were passed in
        if (JSON.stringify(this.args) != '{}') {
            //Add custom properties as defaults
            this.args.view = "admin_namesearch"
            this.args.featureCollection = { source: "GeoDB" };

            //Get the text arg, pass it to function
            this.searchterm = "";
            if (this.args.searchterm) {
                this.searchterm = this.args.searchterm;
            }
            else {
                //No search term, abort.
                this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];
                this.args.errorMessage = 'You must specify a search term.';
                respond(this.req, this.res, this.args);
                return;
            }

            //Try querying internal GeoDB - strict (exact match) first
            executeAdminNameSearch(this.searchterm, { strict: true, returnGeometry: this.args.returnGeometry }, this);
        }
        else {
            //If no arguments are provided, just show the regular HTML form.
            this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Admin Query by Name" }];
            this.args.view = "admin_namesearch";
            respond(this.req, this.res, this.args);
        }
    }, function (result) {
        //this is the result of executeAdminNameSearch 'strict' callback
        //result should be sucess or error.  If success, return results to user.
        //if error or no results, try the non-strict results

        if (result && result.status == "success") {
            if (result.rows.length > 0) {
                //Return results

                this.args.featureCollection = geoJSONFormatter(result.rows); //The page will parse the geoJson to make the HTMl
                this.args.featureCollection.source = "GeoDB";
                this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];
                respond(this.req, this.res, this.args);
                return;
            }
            else {
                //no matches from GeoDb in strict mode
                //Try querying internal GeoDB - not strict
                executeAdminNameSearch(this.searchterm, { strict: false, returnGeometry: this.args.returnGeometry }, this);
            }
        }
        else if (result && result.status == "error") {
            //Try querying internal GeoDB - not strict
            executeAdminNameSearch(this.searchterm, { strict: false, returnGeometry: this.args.returnGeometry }, this);
        }
        else {
            //Try querying internal GeoDB - not strict
            executeAdminNameSearch(this.searchterm, { strict: false, returnGeometry: this.args.returnGeometry }, this);
        }
    }, function (result) {
        //this is the result of executeAdminNameSearch 'not-strict' callback
        //result should be sucess or error.  If success, return results to user.
        //if error or no results, try GeoNames

        if (result && result.status == "success") {
            if (result.rows.length > 0) {
                //Return results
                //Check which format was specified

                this.args.featureCollection = geoJSONFormatter(result.rows); //The page will parse the geoJson to make the HTMl
                this.args.featureCollection.source = "GeoDB";
                this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];

                //Render HTML page with results at bottom
                respond(this.req, this.res, this.args);

                return;
            }
            else {
                //no matches from GeoDb
                //Check GeoNames
                executeGeoNamesAPISearch(this.searchterm, this)
            }
        }
        else {
            //Check GeoNames
            executeGeoNamesAPISearch(this.searchterm, this)
        }
    },
    function (statuscode, result) {
        //This is the callback from the GeoNamesAPI Search
        //check the result and decide what to do.

        
        this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];


        if (statuscode && statuscode == "200") {
            //we got a response, decide what to do
            if (result && result.geonames && result.geonames.length > 0) {

                this.args.featureCollection = geoJSONFormatter(result.geonames); //The page will parse the geoJson to make the HTMl
                this.args.featureCollection.source = "Geonames";

                //Render HTML page with results at bottom
                respond(this.req, this.res, this.args);
            }
            else {
                //no results
                var infoMessage = "No results found.";
                this.args.infoMessage = infoMessage;
                this.args.featureCollection = { message: infoMessage, type: "FeatureCollection", features: [] }; //The page will parse the geoJson to make the HTMl
                this.args.featureCollection.source = "Geonames";

                //Render HTML page with results at bottom
                respond(this.req, this.res, this.args);
            }
        } else {
            //handle a non 200 response
            this.args.errorMessage = "Unable to complete operation. Response code: " + statuscode;
            this.args.featureCollection = { message: this.args.errorMessage, type: "FeatureCollection", features: [] }; //The page will parse the geoJson to make the HTMl

            //Render HTML page with results at bottom
            respond(this.req, this.res, this.args);
        }
    }
);

routes['getAdminStack'] = flow.define(

    function (req, res) {
        //Stash the node request and response objects.
        this.req = req;
        this.res = res;

        //Grab POST or QueryString args depending on type
        if (this.req.method.toLowerCase() == "post") {
            //If a post, then arguments will be members of the this.req.body property
            this.args = this.req.body;
        }
        else if (this.req.method.toLowerCase() == "get") {
            //If request is a get, then args will be members of the this.req.query property
            this.args = this.req.query;
        }

        //Detect if args were passed in
        if (JSON.stringify(this.args) != '{}') {
            //Add custom properties as defaults
            this.args.view = "get_admin_stack";
            this.args.title = "GeoWebServices";
            this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Get Admin Stack" }];

            //Set up an object to hold search terms
            var searchObj = {};

            //All 3 need to be defined OR WKT & Datasource and Level.
            if (this.args.uniqueid && this.args.adminlevel && this.args.datasource) {
                //Run the search
                searchObj.uniqueid = this.args.uniqueid;
                searchObj.adminlevel = this.args.adminlevel;
                searchObj.datasource = this.args.datasource;
                searchObj.isSpatial = false;
            }
            else {
                //did they pass in GEOM And Datasource and Level?
                if (this.args.wkt && this.args.datasource) {
                    //Use the geometry to search
                    searchObj.wkt = this.args.wkt;
                    searchObj.datasource = this.args.datasource; //optional
                    searchObj.adminlevel = this.args.adminlevel; //optional
                    searchObj.isSpatial = true;
                }
                else {
                    //Let 'em know, then abort
                    this.args.errorMessage = "Please provide either a boundary's uniqueID, level and datasource, OR provide a WKT point and datasource.";
                    this.args.featureCollection = { message: this.args.errorMessage, type: "FeatureCollection", features:  [] }; //The page will parse the geoJson to make the HTMl

                    //Render HTML page with results at bottom
                    respond(this.req, this.res, this.args);
                    return;
                }
            }

            //Try querying internal GeoDB
            executeAdminStackSearch(searchObj, this);
        }
        else {
            //If the querystring is empty, just show the regular HTML form.
            //Render Query Form without any results.
            this.args.view = "get_admin_stack";
            respond(this.req, this.res, this.args);
        }
    }, function (result) {
        //The result of execute Admin Stack Search
        //successful search
        if (result.status == "success") {
            this.args.featureCollection = geoJSONFormatter(result.rows); //format as JSON
            respond(this.req, this.res, this.args);
        }
        else if (result.status == "error") {
            log(result.message.text);
            this.args.errorMessage = "error: " + result.message.text;
            respond(this.req, this.res, this.args);
        }
        
    }
);


//Define Routes
//Root Request - redirect to services page
app.get('/', function (req, res) { res.redirect('/services') });

//List All Services
app.get('/services', routes['listServices']);

//Admin Name Query - get - display page with default form
app.get('/services/nameSearch', routes['nameSearch']);

//When a Query gets posted - read attributes from post and render results
app.post('/services/nameSearch', routes['nameSearch']);

//Admin Stack Query - get - display page with default form
app.get('/services/getAdminStack', routes['getAdminStack']);

//When a Query gets posted - read attributes from post and render results
app.post('/services/getAdminStack', routes['getAdminStack']);

//Route search path to static search html file
app.get('/search', function (req, res) {
    res.sendfile(__dirname + '/public/search/search.html');
});



//Start listening
http.createServer(app).listen(app.get('port'), app.get('ipaddr'), function () {
    log('Express server listening on port ' + app.get('port'));
});


//Functions
//pass in a search term, check the Geodatabase for matching names
//This is part 1 of 2 for getting back an admin stack
function executeAdminNameSearch(searchterm, options, callback) {

    var sql = "";
    if (options) {
        //TODO - clean up all of these options
        if (options.strict == true) {
            if (options.returnGeometry == "yes") {
                //Try for exact match - with geom
                sql = "select * from udf_executestrictadminsearchbynamewithgeom('" + searchterm + "')";
            }
            else {
                //Try for exact match - without geom
                sql = "select * from udf_executestrictadminsearchbyname('" + searchterm + "')";
            }
        }
        else {
            if (options.returnGeometry == "yes") {
                //use wildcard or partial match - with geom
                sql = "select * from udf_executeadminsearchbynamewithgeom('" + searchterm + "')";
            }
            else {
                //use wildcard or partial match - without geom
                sql = "select * from udf_executeadminsearchbyname('" + searchterm + "')";
            }
        }
    }
    else {
        if (options.returnGeometry == "yes") {
            //use wildcard or partial match - with geom
            sql = "select * from udf_executeadminsearchbynamewithgeom('" + searchterm + "')";
        }
        else {
            //use wildcard or partial match - without geom
            sql = "select * from udf_executeadminsearchbyname('" + searchterm + "')";
        }
    }

    //run it
    executePgQuery(sql, callback);
}

//pass in a search object with uniqueid, admin level, datasource OR WKT, find the matching administrative hierarchy
function executeAdminStackSearch(searchObject, callback) {
    var sql = "";

    //See if this is a spatial (WKT) search or not
    if (searchObject.isSpatial == false) {
        //lookup by id, datasource and level
        //build sql query
        sql = buildAdminStackQuery(searchObject.uniqueid, searchObject.datasource, searchObject.adminlevel);
        log(sql);

        //run it
        executePgQuery(sql, callback);
    }
    else {
        //do a spatial search

        //If user specifies admin level, then use that to start with, otherwise, start with the lowest level for that datasource
        var adminLevel = 2;

        if (searchObject.adminlevel) {
            //use user's level
            adminLevel = searchObject.adminlevel;
        }
        else {
            //use a specified level
            adminLevel = dsLevels[searchObject.datasource.toLowerCase()];
        }

        log(adminLevel);

        //Admin level will be passed in iteratively until we find a match.
        function hitTest(level) {
            if (level >= 0) {
                //Do Hit Test, starting with lowest available admin level
                log("In hit test loop.  checking level " + level);
                sql = buildAdminStackSpatialQuery(searchObject.wkt, searchObject.datasource, level);
                executePgQuery(sql, function (result) {
                    if (result.status == "success") {
                        //we found a match, break out.
                        if (result.rows.length > 0) {
                            callback(result);
                            return;
                        }
                        else {
                            //continue searching
                            hitTest(level - 1);
                        }
                    }
                    else {
                        //continue searching
                        hitTest(level-1);
                    }
                });
            }
        }
        //initiate loop
        hitTest(adminLevel);
    }
}

function executePgQuery(query, callback) {
    var result = { status: "success", rows: [] }; //object to store results, and whether or not we encountered an error.

    //Just run the query
    //Setup Connection to PG
    var client = new pg.Client(conString);
    client.connect();

    //Log the query to the console, for debugging
    console.log("Executing query: " + query);
    var query = client.query(query);

    //If query was successful, this is iterating thru result rows.
    query.on('row', function (row) {
        result.rows.push(row);
    });

    //Handle query error - fires before end event
    query.on('error', function (error) {
        //req.params.errorMessage = error;
        result.status = "error";
        result.message = error;
    });

    //end is called whether successfull or if error was called.
    query.on('end', function () {
        //End PG connection
        client.end();
        callback(result); //pass back result to calling function
    });
}



//pass in a search term, check the Geonames API for matching names
function executeGeoNamesAPISearch(searchterm, callback) {
    //Reach out to GeoNames API

    //Encode for URL
    searchterm = encodeURIComponent(searchterm);

    var options = {
        host: 'api.geonames.org',
        path: '/search?name=' + searchterm + '&username=' + settings.geonames.username + '&featureClass=A&featureClass=P&type=json',
        method: 'GET',
        port: 80,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    rest.getJSON(options, function (statusCode, result) {
        log("got geonames result.");
        callback(statusCode, result)
    }); //send result back to calling function
}

////Take in results object, return GeoJSON (if there is geometry)
function geoJSONFormatter(rows, geom_fields_array) {
    //Take in results object, return GeoJSON
    if (!geom_fields_array) geom_fields_array = ["geom"]; //default

    //Loop thru results
    var featureCollection = { "type": "FeatureCollection", "features": [] };

    rows.forEach(function (row) {
        var feature = { "type": "Feature", "properties": {} };
        //Depending on whether or not there is geometry properties, handle it.  If multiple geoms, use a GeometryCollection output for GeoJSON.

        if (geom_fields_array && geom_fields_array.length == 1) {
            //single geometry
            if (row[geom_fields_array[0]]) {
                feature.geometry = JSON.parse(row[geom_fields_array[0]]);
                //remove the geometry property from the row object so we're just left with non-spatial properties
                delete row[geom_fields_array[0]];
            }
        }
        else if (geom_fields_array && geom_fields_array.length > 1) {
            //if more than 1 geom, make a geomcollection property
            feature.geometry = { "type": "GeometryCollection", "geometries": [] };
            geom_fields_array.forEach(function (item) {
                feature.geometry.geometries.push(row[item]);
                //remove the geometry property from the row object so we're just left with non-spatial properties
                delete row[item];
            });
        }

        feature.properties = row;
        featureCollection.features.push(feature);
    })

    return featureCollection;
}

//The lowest level for each datasource
var dsLevels = {};
dsLevels["gadm"] = 5;
dsLevels["gaul"] = 2;
dsLevels["naturalearth"] = 1;
dsLevels["local"] = 2;

//Columns by level and datasource
var dsColumns = {};

//Columns aliased to be consistent between data sources.
dsColumns["gadm0"] = "ogc_fid as id, id_0 as adm0_code, name_0 as adm0_name";
dsColumns["gadm1"] = "ogc_fid as id, id_0 as adm0_code, name_0 as adm0_name, id_1 as adm1_code, name_1 as adm1_name";
dsColumns["gadm2"] = "ogc_fid as id, id_0 as adm0_code, name_0 as adm0_name, id_1 as adm1_code, name_1 as adm1_name, id_2 as adm2_code, name_2 as adm2_name";
dsColumns["gadm3"] = "ogc_fid as id, id_0 as adm0_code, name_0 as adm0_name, id_1 as adm1_code, name_1 as adm1_name, id_2 as adm2_code, name_2 as adm2_name, id_3 as adm3_code, name_3 as adm3_name";
dsColumns["gadm4"] = "ogc_fid as id, id_0 as adm0_code, name_0 as adm0_name, id_1 as adm1_code, name_1 as adm1_name, id_2 as adm2_code, name_2 as adm2_name, id_3 as adm3_code, name_3 as adm3_name, id_4 as adm4_code, name_4 as adm4_name";
dsColumns["gadm5"] = "ogc_fid as id, id_0 as adm0_code, name_0 as adm0_name, id_1 as adm1_code, name_1 as adm1_name, id_2 as adm2_code, name_2 as adm2_name, id_3 as adm3_code, name_3 as adm3_name, id_4 as adm4_code, name_4 as adm4_name, id_5 as adm5_code, name_5 as adm5_name";

dsColumns["gaul0"] = "ogc_fid as id, adm0_code, adm0_name";
dsColumns["gaul1"] = "ogc_fid as id, adm0_code, adm0_name, adm1_code, adm1_name";
dsColumns["gaul2"] = "ogc_fid as id, adm0_code, adm0_name, adm1_code, adm1_name, adm2_code, adm2_name";

dsColumns["naturalearth0"] = "ogc_fid as id, adm0_a3 as adm0_code, name as adm0_name";
dsColumns["naturalearth1"] = "ogc_fid as id, adm0_a3 as adm0_code, admin as adm0_name, name as adm1_code, name as adm1_name"; //no adm1 code

//TODO
dsColumns["local0"] = "ogc_fid, adm0_code, adm0_name";
dsColumns["local1"] = "ogc_fid, adm0_code, adm0_name, adm1_code, adm1_name";

function buildAdminStackQuery(rowid, datasource, level) {
    //build up the query to be executed
    var query = "";
    var table = "";
    switch (datasource.toLowerCase()) {
        case "gadm":
            table = "gadm" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ogc_fid = " + rowid;
            break;

        case "gaul":
            table = "gaul" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ogc_fid = " + rowid;
            break;

        case "naturalearth":
            table = "naturalearth" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ogc_fid = " + rowid;
            break;

        case "local":
            table = "local" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE where ogc_fid = " + rowid;
            break;
    }

    return query;
}

function buildAdminStackSpatialQuery(wkt, datasource, level) {
    //build the spatial query
    var query = "";
    var table = "";

    switch (datasource.toLowerCase()) {
        case "gadm":
            table = "gadm" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText('" + wkt + "', 4326), geom)";
            break;

        case "gaul":
            table = "gaul" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText('" + wkt + "', 4326), geom)";
            break;

        case "naturalearth":
            table = "naturalearth" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText('" + wkt + "', 4326), geom)";
            break;

        case "local":
            table = "local" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText('" + wkt + "', 4326), geom)";
            break;
    }

    return query;
}

function respond(req, res, args) {
    //Write out a response as JSON or HTML with the appropriate arguments.  Add more formats here if desired
    if (!args.format || args.format == "html") {
        res.render(args.view, args)
    }
    else if (args.format && args.format == "GeoJSON") {
        res.jsonp(args.featureCollection);
    }
}

//Utilities
function log(message) {
    //Write to console and to loggly
    logclient.log(settings.loggly.logglyKey, message);
    console.log(message);
}

//Determine if a string contains all numbers.
function IsNumeric(sText) {
    var ValidChars = "0123456789";
    var IsNumber = true;
    var Char;
    sText.replace(/\s+/g, '')

    for (i = 0; i < sText.length && IsNumber == true; i++) {
        Char = sText.charAt(i);
        if (ValidChars.indexOf(Char) == -1) {
            IsNumber = false;
        }
    }
    return IsNumber;
}
