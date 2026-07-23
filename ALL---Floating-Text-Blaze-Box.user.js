// ==UserScript==
// @name         ALL - Floating Text Blaze Box
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Adds a floating textbox for Text Blaze — observer disconnects after adding.
// @match        https://bristow-app.azurewebsites.net/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
(function() {
  var url = window.location.href;
  if (url.includes("/Orders/Jobs/Edit")) return;
  if (url.includes("/ReportGenerator/PrintPDF")) return;
  if (url.includes("/Orders/Orders/Edit") && url.includes("handler=ViewAeroFile")) return;

  if (document.getElementById("tm-floating-box")) return;
  var box = document.createElement("textarea");
  box.id = "tm-floating-box";
  box.placeholder = "TYPE MACRO HERE";
  Object.assign(box.style, {
    position:"fixed", top:"5px", left:"190px", width:"170px", height:"40px",
    zIndex:2147483647, padding:"8px", fontSize:"13px", border:"2px solid #444",
    background:"#fff", color:"black"
  });
  document.body.appendChild(box);
})();
