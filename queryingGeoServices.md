Querying RedCross GeoServices
=============================

Overview
--------

The Red Cross has undertaken a project called ECOS with the goal of having a central system for tracking and reporting on their global projects and activities.  In order to enable spatial queries and spatial reporting and mapping (# projects by district for example), projects and activities need to be tagged with their location, including all levels of administrative boundaries and lat/lng where available.

To that end, Red Cross has begun developing a set of Geo Web Services to allow for searching and retrieval of an entire hierarchy of administrative boundaries from a variety of global administrative datasets including GADM, GAUL, NaturalEarth and GeoNames. In addition, custom Red Cross boundaries (regional chapter boundaries for example) and local administrative boundaries will be available if requested.

These services were created specifically to support the placename search feature of the Red Cross’ ECOS project tracking tool, though additional endpoints and functionality may be added in the future.

Sample Workflow
---------------
Jim is a Red Cross employee who needs to enter a new activity into ECOS.  The activity is happening in Port-au-Prince, Haiti.  

Jim opens his browser and logs into ECOS, then clicks to create a new activity.  He enters all of the project information step by step into the web form.  At the bottom of the form is a location field.  He clicks the link next to it and a new window opens, which then prompts him to enter a placename.

Jim types Port-au-Prince and hits enter.  3 possible matches are returned, 2 from the GADM dataset, and 1 from the GAUL dataset.  He chooses the level 3 option and clicks OK.  The window closes which leaves him back at the ECOS data entry screen.  He then clicks the ‘submit’ button and the activity is saved.

Service Endpoints
-----------------

There are currently 2 main web service REST endpoints located on the development server [http://54.213.94.50/services](http://54.213.94.50/services)

1. Name Search: [http://54.213.94.50/services/nameSearch](http://54.213.94.50/services/nameSearch)

2. Get Admin Stack: [http://54.213.94.50/services/getAdminStack](http://54.213.94.50/services/getAdminStack)

There is also a search page that will be called from ECOS that will allow the user to do the placename search and send the results back to ECOS.  This page is located at [http://54.213.94.50/search](http://54.213.94.50/search).


### Name Search ###

The Name Search endpoint is a RESTful web service that can accept GET and POST requests.  It also supports JSONP response format.
Parameters

- **searchterm** (_text_): The placename to search for.  Should not include commas.  Does not search for addresses or fully qualified city/state/country strings.

- **featureid** (_integer_): If you have the featureID of a particular admin boundary, you can look up a feature using it.  If ‘searchterm’ is specified, then featureid is ignored.

- **format** (_string_): Options are html or GeoJSON.  HTML will simply return a search form with results at the bottom.  Used for manual querying or testing.

- **returnGeometry** (_string_): Should the service return the coordinates of the admin polygon or not? Options are yes or no.

#### Description ####

The NameSearch web service searches the RedCross Admin Boundary database in the following manner:

1.	An exact match search is run against all internal datasources.   If an exact match is found, then a result is returned. If no exact match is found:

2.	A ‘loose’ search is run against all internal datasources.  For example, the searchterm ‘King’ might return King County, Washington and Kingston, Jamaica and any other admin boundary starting with the word King.  If no loose match is found:

3.	The searchterm is sent to the [Geonames](http://www.geonames.org/) API.  Geonames will usually find a result, which will then be returned.

#### Sample JSONP Call (jQuery 2.0.3) ####

'''javascript
var postArgs = {
	searchterm: "dallas",
	format: "GeoJSON",
	returnGeometry: "yes"
};

var url = 'http://54.213.94.50/services/nameSearch';

//Send POST, using JSONP
$.getJSON(url + "?callback=?", postArgs).done(function (data) {
	handleNameSearchResponse(data);
}).fail(function (jqxhr, textStatus, error) {
	var err = textStatus + ', ' + error;
	console.log("Request Failed: " + err);
});
'''

#### Results ####

The GeoJSON or JSON result from this service will have 1 of 2 structures, depending on whether a match was found from the internal GeoDB, or if a match was found from the GeoNames API.

An example of a JSON result from a GeoDB match is:

'''json
{
	"type": "FeatureCollection",
	"features": [
		{
			"type": "Feature",
			"properties": {
				"stackid": "1815",
				"featureid": "296949",
				"name": "Colima",
				"level": "1",
				"source": "GADM",
				"country": "Mexico",
				"year": "2012",
				"fullname": "Colima, Mexico"
			}
		}
	],
	"source": "GeoDB"
}
'''

An example of a JSON result from Geonames is:

'''json
{
	"type": "FeatureCollection",
	"features": [
		{
			"type": "Feature",
			"properties": {
				"countryId": "6252001",
				"adminCode1": "WA",
				"countryName": "United States",
				"fclName": "city, village,...",
				"countryCode": "US",
				"lng": "-122.43457",
				"fcodeName": "populated place",
				"toponymName": "Spanaway",
				"fcl": "P",
				"name": "Spanaway",
				"fcode": "PPL",
				"geonameId": 5811581,
				"lat": "47.10399",
				"adminName1": "Washington",
				"population": 27227				
			}
		}
	],
	"source": "Geonames"
}
'''

Assuming one of the two results was returned, a 2nd call can be made to the GetAdminStack web service to actually retrieve the full hierarchy of administrative boundaries for the location returned from this web service.

### Get Admin Stack ###

The GetAdminStack endpoint is a RESTful web service that can accept GET and POST requests.  It also supports JSONP response format.  There are 3 ways to query this service:

1.	By FeatureID
2.	By StackID, level and datasource
3.	By X,Y and datasource

#### Parameters ####

- **featureid** (_integer_): If the featureID is available from the NameSearch web service, it can be used by itself to retrieve the full administrative boundary stack.

- **stackid** (_integer_): StackID is available as a property of the NameSearch web service.  It can be used in conjunction with the level and datasource input parameters to retrieve a particular admin stack.

- **adminlevel** (_integer_): The level corresponding to the stackid and datasource. 

- **datasource** (_string_): The raw dataset from which the stack originated. Options are GAUL, GADM and NaturalEarth.

- **format** (_string_): Options are html or GeoJSON.  HTML will simply return a search form with results at the bottom.  Used for manual querying or testing.

- **wkt** (_string_): A Well Known Text representation of a feature.  Could be any valid geometry including point, line, polygon or multipoint. Example: POINT(85.341 25.811) (X,Y)

#### Sample JSONP Call (jQuery 2.0.3) ####

'''javascript
var postArgs = {
	featureid: 544785,
	format: "GeoJSON"	
};

var url = 'http://54.213.94.50/services/getAdminStack';

//Send POST, using JSONP
$.getJSON(url + "?callback=?", postArgs).done(function (data) {
	handleAdminStackResponse(data);
}).fail(function (jqxhr, textStatus, error) {
	var err = textStatus + ', ' + error;
	console.log("Request Failed: " + err);
});
'''

#### Results ####

A JSON result will have the following structure, but may differ depending on how ‘deep’ the administrative stack is.

For example, this stack has admin levels 0 through 5:

'''json
{
	"type": "FeatureCollection",
	"features": [
		{
			"type": "Feature",
			"properties": {
				"id": 37549,
				"adm0_code": 118,
				"adm0_name": "Kenya",
				"adm1_code": 3,
				"adm1_name": "Eastern",
				"adm2_code": 13,
				"adm2_name": "Embu",
				"adm3_code": 59,
				"adm3_name": "Gachoka",
				"adm4_code": 246,
				"adm4_name": "Embu Municipality",
				"adm5_code": 922,
				"adm5_name": "Dallas/Stadium",
			}
		}
	]
}
'''

Other results may have fewer or more admin levels depending on the datasource.



