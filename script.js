async function processFiles() {
    try {
        const loading = document.getElementById('loading');
        loading.style.display = 'block';
        
        const [timetableText, coursesText] = await Promise.all([
            parsePDF('timetable-pdf'),
            parsePDF('courses-pdf')
        ]);

        const timetableData = processTimetable(timetableText);
        const coursesData = processCourses(coursesText);
        const matchedCourses = matchCourses(timetableData, coursesData);

        if (!matchedCourses.length) {
            throw new Error("No matching courses found. Check your input files.");
        }

        const pdfBytes = await generatePDF(matchedCourses);
        downloadPDF(pdfBytes, document.getElementById('filename').value);
    } catch (error) {
        alert(`Error: ${error.message}`);
        console.error(error);
    } finally {
        loading.style.display = 'none';
    }
}

async function parsePDF(elementId) {
    const file = document.getElementById(elementId).files[0];
    if (!file) throw new Error("Please select both PDF files");

    const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });

    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        console.log(`Raw text items from page ${i} of ${file.name}: `, content.items);
        text += content.items.map(item => item.str).join(' ');
    }
    console.log(`Full extracted text from ${file.name}: `, text);
    return text;
}

function processTimetable(text) {
    console.log("Processing Timetable with text: ", text);
    const courseRegex = /([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s\d{3,4})\s+(?:Lec\s\d+\s)?(\d{1,2}:\d{2}[ap]?m?[ -]+[\d{1,2}:\d{2}[ap]?m?)/gi;
    const matches = [...text.matchAll(courseRegex)];
    console.log("Timetable regex matches: ", matches);
    const processedEntries = matches.map(match => ({ code: match[1].replace(/\s+/g, ' ').trim(), time: normalizeTime(match[2]) }));
    console.log("Processed timetable entries: ", processedEntries);
    return processedEntries;
}

function processCourses(text) {
    console.log("Processing Courses with text: ", text);
    const courseRegex = /([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s\d{3,4})/g;
    const matches = text.match(courseRegex);
    console.log("Courses regex matches: ", matches);
    const processedCodes = [...new Set(matches)].map(code => code.replace(/\s+/g, ' ').trim());
    console.log("Processed course codes: ", processedCodes);
    return processedCodes;
}

function normalizeTime(timeStr) {
    console.log("Normalizing time (input): ", timeStr);

    let processedTimeStr = timeStr.toLowerCase();
    processedTimeStr = processedTimeStr.replace(/\s*to\s*|\s*-\s*/g, '-'); // Standardize separators

    const timeParts = processedTimeStr.split('-');
    let startTimeRaw = timeParts[0].trim();
    let endTimeRaw = timeParts.length > 1 ? timeParts[1].trim() : null;

    function parseAndFormatTimeComponent(timeComponent, isEndTime = false, refStartHour24 = null, refStartAmPm = null) {
        if (!timeComponent) return null;

        let hourStr = '', minuteStr = '00', ampm = '';
        let componentProcessed = timeComponent;

        if (componentProcessed.includes('a')) {
            ampm = 'AM';
            componentProcessed = componentProcessed.replace(/am?/, '');
        } else if (componentProcessed.includes('p')) {
            ampm = 'PM';
            componentProcessed = componentProcessed.replace(/pm?/, '');
        }
        componentProcessed = componentProcessed.trim();

        if (componentProcessed.includes(':')) {
            [hourStr, minuteStr] = componentProcessed.split(':');
            minuteStr = minuteStr.padStart(2, '0');
        } else {
            hourStr = componentProcessed; // Assumed to be hour
        }
        
        let hour = parseInt(hourStr);

        if (!ampm) { // Infer AM/PM if not specified
            if (isEndTime && refStartAmPm) {
                if (refStartAmPm === 'AM') {
                    if (hour === 12) ampm = 'PM'; // e.g. 10 AM - 12 (PM)
                    else if (refStartHour24 && hour < refStartHour24 && hour <= 6) ampm = 'PM'; // e.g. 10 AM - 1 (PM)
                    else ampm = 'AM';
                } else if (refStartAmPm === 'PM') {
                    if (hour === 12) ampm = 'AM'; // e.g. 10 PM - 12 (AM, midnight)
                    else if (refStartHour24 && hour < refStartHour24 && hour <= 6) ampm = 'AM'; // e.g. 10 PM - 1 (AM)
                    else ampm = 'PM';
                } else { // Should not happen if refStartAmPm is provided
                    ampm = (hour >= 7 && hour <= 11) ? 'AM' : 'PM';
                }
            } else { // For start time, or if end time has no reference
                if (hour === 12) ampm = 'PM'; // 12 is PM unless specified as AM
                else if (hour >= 7 && hour <= 11) ampm = 'AM';
                else if (hour >= 1 && hour <= 6) ampm = 'PM';
                else ampm = 'PM'; // Default for ambiguous like 6-7
            }
        }
        
        let currentHour24 = hour;
        if (ampm === 'AM' && hour === 12) currentHour24 = 0; // Midnight case
        else if (ampm === 'PM' && hour < 12) currentHour24 += 12;

        return { hour: hour, minute: minuteStr, ampm: ampm, hour24: currentHour24, full: `${hour}:${minuteStr} ${ampm}` };
    }

    const startTimeDetails = parseAndFormatTimeComponent(startTimeRaw);
    let finalStr = startTimeDetails.full;

    if (endTimeRaw) {
        const endTimeDetails = parseAndFormatTimeComponent(endTimeRaw, true, startTimeDetails.hour24, startTimeDetails.ampm);
        finalStr += ` - ${endTimeDetails.full}`;
    }

    console.log("Normalized time output: ", finalStr);
    return finalStr;
}

function matchCourses(timetable, courses) {
    console.log("Matching courses with timetable: ", timetable, "and courses: ", courses);
    const courseSet = new Set(courses);
    console.log("Course set for matching: ", courseSet);
    const matched = timetable.filter(entry => courseSet.has(entry.code))
        .sort((a, b) => a.time.localeCompare(b.time));
    console.log("Matched courses: ", matched);
    return matched;
}

async function generatePDF(courses) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    
    let yPos = 350;
    page.drawText("Personalized Timetable\n\n", { x: 50, y: yPos, size: 20 });
    yPos -= 30;

    courses.forEach(course => {
        page.drawText(`${course.code}: ${course.time}`, { x: 50, y: yPos, size: 12 });
        yPos -= 20;
        if (yPos < 50) {
            yPos = 350;
            page = pdfDoc.addPage([600, 400]);
        }
    });

    return await pdfDoc.save();
}

function downloadPDF(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function debugProcessPDFs() {
    const loading = document.getElementById('loading');
    loading.style.display = 'block';
    console.log("Starting debugProcessPDFs with sample files...");

    try {
        // Define file paths for sample PDFs
        const timetablePDFPath = './test pdf/general time table.pdf';
        const coursesPDFPath = './test pdf/300 st.pdf';

        console.log(`Fetching timetable PDF: ${timetablePDFPath}`);
        const timetableResponse = await fetch(timetablePDFPath);
        if (!timetableResponse.ok) throw new Error(`Failed to fetch ${timetablePDFPath}: ${timetableResponse.statusText}`);
        const timetableArrayBuffer = await timetableResponse.arrayBuffer();
        console.log("Timetable PDF fetched successfully.");

        console.log(`Fetching courses PDF: ${coursesPDFPath}`);
        const coursesResponse = await fetch(coursesPDFPath);
        if (!coursesResponse.ok) throw new Error(`Failed to fetch ${coursesPDFPath}: ${coursesResponse.statusText}`);
        const coursesArrayBuffer = await coursesResponse.arrayBuffer();
        console.log("Courses PDF fetched successfully.");

        // Temporarily adapt parsePDF to take ArrayBuffer directly for debugging
        // Or, more robustly, make parsePDF flexible, which is harder for a subtask.
        // For this subtask, we'll simulate file objects for parsePDF.

        console.log("Parsing timetable PDF...");
        const timetableText = await parsePDFArrayBuffer(timetableArrayBuffer, 'general time table.pdf');
        console.log("Parsing courses PDF...");
        const coursesText = await parsePDFArrayBuffer(coursesArrayBuffer, '300 st.pdf');
        
        console.log("Processing timetable text...");
        const timetableData = processTimetable(timetableText);
        console.log("Processing courses text...");
        const coursesData = processCourses(coursesText);
        
        console.log("Matching courses...");
        const matchedCourses = matchCourses(timetableData, coursesData);

        if (!matchedCourses.length) {
            console.warn("Debug: No matching courses found.");
            alert("Debug: No matching courses found. Check console for details.");
        } else {
            console.log("Debug: Matched courses found: ", matchedCourses);
            // Optionally, generate and download the PDF
            // const pdfBytes = await generatePDF(matchedCourses);
            // downloadPDF(pdfBytes, "DebugTimetable");
            alert("Debug: Processing complete. Check console for detailed logs.");
        }

    } catch (error) {
        alert(`Debug Error: ${error.message}`);
        console.error("Error during debugProcessPDFs: ", error);
    } finally {
        loading.style.display = 'none';
        console.log("Finished debugProcessPDFs.");
    }
}

// Helper function to use with pdfjsLib directly with an ArrayBuffer
async function parsePDFArrayBuffer(arrayBuffer, fileName) {
    console.log(`Parsing ${fileName} from ArrayBuffer...`);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    console.log(`${fileName} document loaded. Pages: ${pdf.numPages}`);
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        console.log(`Getting page ${i} for ${fileName}`);
        const page = await pdf.getPage(i);
        console.log(`Getting text content for page ${i} of ${fileName}`);
        const content = await page.getTextContent();
        // The logging for individual items is already in the main parsePDF, 
        // but we can add a summary here if needed.
        console.log(`Raw text items from page ${i} of ${fileName}: `, content.items);
        text += content.items.map(item => item.str).join(' ') + '\n'; // Add newline between pages
    }
    console.log(`Full extracted text from ${fileName} (ArrayBuffer): `, text);
    return text;
}
