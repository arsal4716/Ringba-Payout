// App.js - Updated React component with tab selection for Ringba and CallGrid
import React, { useState } from "react";
import {
  Container,
  Row,
  Col,
  Card,
  Form,
  Button,
  Alert,
  Spinner,
  ProgressBar,
  Badge,
  Tabs,
  Tab,
} from "react-bootstrap";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "bootstrap/dist/css/bootstrap.min.css";
import axios from "axios";

const App = () => {
  const [activeSystem, setActiveSystem] = useState("ringba");
  const [file, setFile] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [processType, setProcessType] = useState("withoutPayout");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batchMessage, setBatchMessage] = useState("");
  const [result, setResult] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!file || !startDate || !endDate) {
      toast.error("Please fill all fields");
      return;
    }

    setLoading(true);
    setProgress(0);
    setResult(null);
    setBatchMessage("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("reportStart", startDate + "T00:00:00Z");
    formData.append("reportEnd", endDate + "T23:59:59Z");
    formData.append("processType", processType);
    formData.append("system", activeSystem);

    try {
      const response = await axios.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setProgress(percentCompleted);
        },
      });

      simulateBatchProgress(response.data.summary?.batches || 5);
      setResult(response.data);
      toast.success(`${activeSystem.toUpperCase()} file processed successfully!`);

      if (response.data.summary) {
        const { total, processed, failed, batches } = response.data.summary;
        toast.info(`Processed ${processed}/${total} records across ${batches} batches`);
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error("Error processing file: " + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const simulateBatchProgress = (totalBatches) => {
    let batch = 1;
    const interval = setInterval(() => {
      if (batch <= totalBatches) {
        const progressPercent = (batch / totalBatches) * 100;
        setProgress(progressPercent);
        setBatchMessage(`Processing batch ${batch}/${totalBatches}...`);
        batch++;
      } else {
        clearInterval(interval);
        setBatchMessage("Finalizing processing...");
        setTimeout(() => setBatchMessage(""), 1500);
      }
    }, 800);
  };

  const getProcessTypeLabel = () => {
    return processType === "withPayout"
      ? "Process with hasPayout Check (Only positive payout amounts)"
      : "Process without hasPayout Check (All records)";
  };

  const getSystemColor = () => {
    return activeSystem === "ringba" ? "primary" : "success";
  };

  const getSystemName = () => {
    return activeSystem === "ringba" ? "Ringba" : "CallGrid";
  };

  return (
    <Container className="mt-4 mb-5">
      <ToastContainer position="top-right" autoClose={5000} />

      <Row className="justify-content-center">
        <Col md={9}>
          <Card className="shadow-lg border-0 rounded-4">
            <Card.Header className={`bg-${getSystemColor()} text-white rounded-top-4 py-3`}>
              <h3 className="mb-0 d-flex align-items-center gap-2">
                <i className="bi bi-currency-dollar"></i>
                Payout CRM - {getSystemName()}
              </h3>
              <small>Version: 2.0 | Updated: May-26-2026</small>
            </Card.Header>

            <Card.Body className="p-4">
              <Tabs
                activeKey={activeSystem}
                onSelect={(k) => {
                  setActiveSystem(k);
                  setResult(null);
                  setFile(null);
                  setStartDate("");
                  setEndDate("");
                  setProcessType("withoutPayout");
                }}
                className="mb-4"
                fill
              >
                <Tab eventKey="ringba" title="Ringba System">
                  <div className="p-2">
                    <small className="text-muted">Update payouts for Ringba calls</small>
                  </div>
                </Tab>
                <Tab eventKey="callgrid" title="CallGrid System">
                  <div className="p-2">
                    <small className="text-muted">Update payouts for CallGrid calls</small>
                  </div>
                </Tab>
              </Tabs>

              <Form onSubmit={handleSubmit}>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Report Start Date</Form.Label>
                      <Form.Control
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        required
                      />
                    </Form.Group>
                  </Col>

                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Report End Date</Form.Label>
                      <Form.Control
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        required
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <Form.Group className="mb-3">
                  <Form.Label>Processing Type</Form.Label>
                  <div className="bg-light p-3 rounded-3">
                    <Form.Check
                      inline
                      type="radio"
                      name="processType"
                      label="Process all records"
                      value="withoutPayout"
                      checked={processType === "withoutPayout"}
                      onChange={(e) => setProcessType(e.target.value)}
                      className="mb-2"
                    />
                    <Form.Text className="text-muted d-block mb-2 ms-4">
                      Processes all records regardless of payout amount
                    </Form.Text>

                    <Form.Check
                      inline
                      type="radio"
                      name="processType"
                      label="Verified Mode - Only process positive payouts"
                      value="withPayout"
                      checked={processType === "withPayout"}
                      onChange={(e) => setProcessType(e.target.value)}
                    />
                    <Form.Text className="text-muted d-block ms-4">
                      Only processes records where payout amount is greater than $0
                    </Form.Text>
                  </div>
                </Form.Group>

                <Form.Group className="mb-4">
                  <Form.Label>Upload Daily Report (.xlsx file)</Form.Label>
                  <Form.Control
                    type="file"
                    accept=".xlsx"
                    onChange={handleFileChange}
                    required
                    className="py-2"
                  />
                  <Form.Text className="text-muted">
                    Required columns: inboundphonenumber, targetname, revenue, payout
                  </Form.Text>
                </Form.Group>

                <Button
                  variant={getSystemColor()}
                  type="submit"
                  disabled={loading}
                  className="w-100 py-2 fw-bold"
                  size="lg"
                >
                  {loading ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Processing {getSystemName()} Updates...
                    </>
                  ) : (
                    `Submit ${getSystemName()} Update`
                  )}
                </Button>
              </Form>

              {loading && (
                <div className="mt-4">
                  <Alert variant="info" className="border-0">
                    <div className="d-flex justify-content-between align-items-center">
                      <span>
                        <Spinner animation="border" size="sm" className="me-2" />
                        {batchMessage || "Starting processing..."}
                      </span>
                      <Badge bg={getSystemColor()} pill className="fs-6">
                        {Math.round(progress)}%
                      </Badge>
                    </div>
                  </Alert>
                  <ProgressBar
                    animated
                    now={progress}
                    variant={getSystemColor()}
                    className="mt-2 rounded-pill"
                    style={{ height: "10px" }}
                  />
                </div>
              )}

              {result && (
                <div className="mt-4">
                  <Alert variant={result.success ? "success" : "danger"} className="border-0">
                    <h5 className="mb-3">
                      {result.success ? "Processing Results" : "Processing Error"}
                    </h5>
                    <p className="mb-2">
                      <strong>System:</strong> {result.system?.toUpperCase()}
                    </p>
                    <p className="mb-2">
                      <strong>Process Type:</strong> {result.processType}
                    </p>
                    <p className="mb-2">
                      <strong>Message:</strong> {result.message}
                    </p>

                    {result.summary && (
                      <div className="mt-3">
                        <h6>Summary:</h6>
                        <div className="d-flex flex-wrap gap-2 mt-2">
                          <Badge bg="secondary" pill className="px-3 py-2">
                            Total: {result.summary.total}
                          </Badge>
                          <Badge bg="success" pill className="px-3 py-2">
                            Processed: {result.summary.processed}
                          </Badge>
                          {result.summary.skippedNoPayout > 0 && (
                            <Badge bg="warning" pill className="px-3 py-2">
                              Skipped (No Payout): {result.summary.skippedNoPayout}
                            </Badge>
                          )}
                          <Badge bg="danger" pill className="px-3 py-2">
                            Failed: {result.summary.failed}
                          </Badge>
                          <Badge bg="info" pill className="px-3 py-2">
                            Batches: {result.summary.batches}
                          </Badge>
                        </div>
                      </div>
                    )}
                  </Alert>

                  {result.invalidRows?.length > 0 && (
                    <Alert variant="warning" className="mt-3">
                      <h6>Invalid Rows ({result.invalidRows.length}):</h6>
                      <div className="small mt-2" style={{ maxHeight: "200px", overflowY: "auto" }}>
                        {result.invalidRows.slice(0, 20).map((row, index) => (
                          <div key={index} className="mb-1">
                            Row {row.rowIndex}: {row.error}
                          </div>
                        ))}
                        {result.invalidRows.length > 20 && (
                          <div className="text-muted">...and {result.invalidRows.length - 20} more</div>
                        )}
                      </div>
                    </Alert>
                  )}

                  {result.noPayoutRecords?.length > 0 && (
                    <Alert variant="info" className="mt-3">
                      <h6> Numbers with No Payout Amount ({result.noPayoutRecords.length}):</h6>
                      <div className="small text-muted mt-2" style={{ maxHeight: "150px", overflowY: "auto" }}>
                        {result.noPayoutRecords.slice(0, 30).join(", ")}
                        {result.noPayoutRecords.length > 30 && (
                          <div>...and {result.noPayoutRecords.length - 30} more</div>
                        )}
                      </div>
                    </Alert>
                  )}

                  {result.noRecordFoundNumbers?.length > 0 && (
                    <Alert variant="warning" className="mt-3">
                      <h6>Numbers with No Call Records Found ({result.noRecordFoundNumbers.length}):</h6>
                      <div className="small text-muted mt-2" style={{ maxHeight: "150px", overflowY: "auto" }}>
                        {result.noRecordFoundNumbers.slice(0, 30).join(", ")}
                        {result.noRecordFoundNumbers.length > 30 && (
                          <div>...and {result.noRecordFoundNumbers.length - 30} more</div>
                        )}
                      </div>
                    </Alert>
                  )}

                  {result.failedRecords?.length > 0 && (
                    <Alert variant="danger" className="mt-3">
                      <h6>Failed Updates ({result.failedRecords.length}):</h6>
                      <div className="small mt-2" style={{ maxHeight: "150px", overflowY: "auto" }}>
                        {result.failedRecords.slice(0, 20).map((record, index) => (
                          <div key={index} className="mb-1">
                            {record.phoneNumber}: {record.error}
                          </div>
                        ))}
                      </div>
                    </Alert>
                  )}
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default App;