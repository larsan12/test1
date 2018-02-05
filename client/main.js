var url = 'http://localhost:3001/'
var socket = io.connect(url);

var canRefresh = false;
var eventsLength = 0;
var events = [];
var canLoad = true;
var canDelete = true;


function activate(b) {
    $("#" + b).attr( "class", "active");
}

function deactivate(b) {
    $("#" + b).attr( "class", "deactive");
}

function refreshData(page) {
    deactivate("refresh");
    let requestStr = url + "refresh_data?page=" + page;
    $.ajax({
        type: "GET",
        url: requestStr,
        contentType: 'application/json',
        success: function(result, status, xhr){
            $("#events").text(result.numberEvents);
            eventsLength = result.numberEvents;
            events = result.events;
            let htmlStr = ""
            events.forEach(e => {
                htmlStr = htmlStr + "<br>" + "<span>" + JSON.stringify(e) + "</span>"
            })
            $("div.json").html(htmlStr);
        },
        error(xhr, status, error) {
            console.log(error);
            alert("some error");
            canRefresh = true;
            activate("refresh");
        }
    });
}


$(document).ready(function(){

    refreshData(0);

    $("#load-button").click(function(){
        if (canLoad) {
            socket.emit('getTenEvents');
            deactivate("load-button");
        }
        canLoad = false;
    });

    $("#remove-button").click(function(){
        if (canDelete) {
            let num = $("#area").val() - 0;
            if (!num || num <= 0 || num > 100) {
                alert("введите корректный процент");
                return;
            };
            canDelete = false;
            deactivate("remove-button");
            $.ajax({
                type: "POST",
                url: url + "remove_data",
                dataType: "json",
                contentType: 'application/json',
                data: JSON.stringify({
                    percentage: num
                }),
                success: function(result, status, xhr){
                    alert(JSON.stringify(result));
                    canDelete = true;
                    canRefresh = true;
                    activate("remove-button");
                    activate("refresh");
                },
                error(xhr, status, error) {
                    alert("some error");
                    canDelete = true;
                    activate("remove-button");
                }
            });

        }

    });

    $("#refresh").click(function(){
        if (canRefresh) {
            canRefresh = false;
            let page = $("#page").val() - 0;
            refreshData(page);
        }
    });

    $("#go").click(function(){
        let page = $("#page").val() - 0;
        refreshData(page);
    });

});

socket.on("eventsLoaded", data => {
    $("#load-info").text(data.number);
    if (data.number == 10) {
        setTimeout(() => {
            activate("load-button");
            $("#load-info").text("")
        }, 1000);
        canLoad = true;
    }
})

socket.on('dbUpdated', () => {
    activate("refresh");
    canLoad = true;
    canRefresh = true;
    activate("refresh");
});
