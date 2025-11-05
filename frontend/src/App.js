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
} from "react-bootstrap";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "bootstrap/dist/css/bootstrap.min.css";
import axios from "axios";

const App = () => {
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

    try {
      const response = await axios.post(
        "/upload",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setProgress(percentCompleted);
          },
        }
      );

      // Simulate batch progress (in real app, you'd use WebSockets)
      simulateBatchProgress();

      setResult(response.data);
      toast.success("File processed successfully!");

      if (response.data.summary) {
        const { total, processed, failed, batches } = response.data.summary;
        toast.info(
          `Processed ${processed}/${total} records across ${batches} batches`
        );
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error(
        "Error processing file: " +
          (error.response?.data?.message || error.message)
      );
    } finally {
      setLoading(false);
      setProgress(0);
      setBatchMessage("");
    }
  };

  const simulateBatchProgress = () => {
    let batch = 1;
    const totalBatches = 10;
    const interval = setInterval(() => {
      if (batch <= totalBatches) {
        const progressPercent = (batch / totalBatches) * 100;
        setProgress(progressPercent);
        setBatchMessage(`Processing batch ${batch}/${totalBatches}...`);
        batch++;
      } else {
        clearInterval(interval);
        setBatchMessage("Finalizing processing...");
      }
    }, 1000);
  };

  const getProcessTypeLabel = () => {
    return processType === "withPayout"
      ? "Process with hasPayout Check (Yes/True)"
      : "Process without hasPayout Check";
  };

  return (
    <Container className="mt-5">
      <ToastContainer position="top-right" autoClose={5000} />

      <Row className="justify-content-center">
        <Col md={8}>
          <Card className="shadow">
            <Card.Header className="bg-primary text-white">
              <h3 className="mb-0">Ringba Payout CRM</h3>
              <small>New Version date is: OCT-04-2025</small>
            </Card.Header>

            <Card.Body>
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
                  <div>
                    <Form.Check
                      inline
                      type="radio"
                      name="processType"
                      label="Process without hasPayout Check"
                      value="withoutPayout"
                      checked={processType === "withoutPayout"}
                      onChange={(e) => setProcessType(e.target.value)}
                    />
                    <Form.Check
                      inline
                      type="radio"
                      name="processType"
                      label="Process with hasPayout Check (Yes/True)"
                      value="withPayout"
                      checked={processType === "withPayout"}
                      onChange={(e) => setProcessType(e.target.value)}
                    />
                  </div>
                  <Form.Text className="text-muted">
                    {processType === "withPayout"
                      ? "Will only process records where hasPayout is Yes/True"
                      : "Will process all records regardless of hasPayout value"}
                  </Form.Text>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Upload Daily .xlsx File</Form.Label>
                  <Form.Control
                    type="file"
                    accept=".xlsx"
                    onChange={handleFileChange}
                    required
                  />
                </Form.Group>

                <Button
                  variant="primary"
                  type="submit"
                  disabled={loading}
                  className="w-100"
                >
                  {loading ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Processing...
                    </>
                  ) : (
                    "Submit"
                  )}
                </Button>
              </Form>

              {loading && (
                <div className="mt-4">
                  <Alert variant="info">
                    <div className="d-flex justify-content-between align-items-center">
                      <span>{batchMessage || "Starting processing..."}</span>
                      <Badge bg="primary">{Math.round(progress)}%</Badge>
                    </div>
                  </Alert>
                  <ProgressBar
                    animated
                    now={progress}
                    variant="primary"
                    className="mt-2"
                  />
                </div>
              )}
              {result && (
                <div className="mt-4">
                  <Alert variant={result.success ? "success" : "danger"}>
                    <h5>Processing Results</h5>
                    <p>
                      <strong>Process Type:</strong> {getProcessTypeLabel()}
                    </p>
                    <p>
                      <strong>Message:</strong> {result.message}
                    </p>

                    {result.summary && (
                      <div className="mt-3">
                        <h6>Summary:</h6>
                        <Row>
                          <Col>
                            <Badge bg="secondary" className="me-2">
                              Total: {result.summary.total}
                            </Badge>
                            <Badge bg="success" className="me-2">
                              Processed: {result.summary.processed}
                            </Badge>
                            {processType === "withPayout" &&
                              result.summary.noPayoutCount > 0 && (
                                <Badge bg="warning" className="me-2">
                                  No Payout: {result.summary.noPayoutCount}
                                </Badge>
                              )}
                            <Badge bg="danger" className="me-2">
                              Failed: {result.summary.failed}
                            </Badge>
                            <Badge bg="info">
                              Batches: {result.summary.batches}
                            </Badge>
                          </Col>
                        </Row>
                      </div>
                    )}
                  </Alert>

                  {result.invalidRows && result.invalidRows.length > 0 && (
                    <Alert variant="warning" className="mt-3">
                      <h6>Invalid Rows ({result.invalidRows.length}):</h6>
                      <ul className="mb-0">
                        {result.invalidRows.map((row, index) => (
                          <li key={index}>
                            Row {row.rowIndex}: {row.error}
                          </li>
                        ))}
                      </ul>
                    </Alert>
                  )}

                  {processType === "withPayout" &&
                    result.noPayoutRecords &&
                    result.noPayoutRecords.length > 0 && (
                      <Alert variant="info" className="mt-3">
                        <h6>
                          Numbers with No Payout Amount (
                          {result.noPayoutRecords.length}):
                        </h6>
                        <div className="text-muted small">
                          {result.noPayoutRecords.join(", ")}
                        </div>
                        <div className="mt-2">
                          <small>
                            <strong>Note:</strong> These numbers have call
                            records, but the payout amount is $0 or less. They
                            were skipped because you selected "Process with
                            hasPayout Check".
                          </small>
                        </div>
                      </Alert>
                    )}

                  {result.noRecordFoundNumbers &&
                    result.noRecordFoundNumbers.length > 0 && (
                      <Alert variant="warning" className="mt-3">
                        <h6>
                          Numbers with No Call Records Found (
                          {result.noRecordFoundNumbers.length}):
                        </h6>
                        <div className="text-muted small">
                          {result.noRecordFoundNumbers.join(", ")}
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
